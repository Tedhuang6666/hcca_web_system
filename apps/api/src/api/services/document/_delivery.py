"""公文正式發文後的電子郵件遞送。"""

from __future__ import annotations

import base64
import html
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.config import settings
from api.models.document import DeliveryMethod, Document, DocumentRecipient, RecipientType
from api.models.org import UserPosition
from api.models.user import User
from api.services.official_print import render_document_print_html, render_print_pdf
from api.services.outbox import emit
from api.services.permission import active_tenure_filter
from api.services.storage import get_storage


@dataclass(frozen=True)
class _EmailRecipient:
    email: str
    recipient: DocumentRecipient


def _is_primary_recipient(recipient: DocumentRecipient) -> bool:
    return recipient.recipient_type in {RecipientType.MAIN, RecipientType.PRIMARY}


def _copy_mark(recipient: DocumentRecipient) -> str:
    return "正本" if _is_primary_recipient(recipient) else "副本"


def _safe_filename(value: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "_", value).strip(". ")
    return (cleaned or fallback)[:180]


def _add_recipient_email(
    recipients_by_email: dict[str, _EmailRecipient],
    email: str | None,
    recipient: DocumentRecipient,
) -> None:
    normalized = (email or "").strip().lower()
    if not normalized:
        return
    existing = recipients_by_email.get(normalized)
    # 同一信箱若同時被列為正本與副本，正本版本的下載檔較完整，優先保留正本。
    if existing is None or (
        _is_primary_recipient(recipient) and not _is_primary_recipient(existing.recipient)
    ):
        recipients_by_email[normalized] = _EmailRecipient(normalized, recipient)


async def _build_document_email_attachments(
    session: AsyncSession,
    doc: Document,
    recipient: DocumentRecipient,
) -> list[dict[str, str]]:
    """建立單一受文者的正式公文 PDF，並讀取公文附件供 Resend 使用。"""
    copy_mark = _copy_mark(recipient)
    html_content = await render_document_print_html(
        session,
        doc,
        copy_mark_override=copy_mark,
        addressed_recipient_name=recipient.name,
    )
    pdf_bytes = await run_in_threadpool(render_print_pdf, html_content)
    serial = _safe_filename(str(doc.serial_number or doc.title or "公文"), "公文")
    recipient_name = _safe_filename(recipient.name, "受文者")
    attachments = [
        {
            "filename": f"{serial}_{copy_mark}_{recipient_name}.pdf",
            "content": base64.b64encode(pdf_bytes).decode("ascii"),
        }
    ]
    storage = get_storage()
    for attachment in doc.attachments:
        # 外部連結沒有可安全代抓的檔案內容，會在信件內文提供原始連結。
        if not attachment.storage_key:
            continue
        content = await storage.read_bytes(attachment.storage_key)
        filename = _safe_filename(str(attachment.display_name or attachment.filename), "附件")
        attachments.append(
            {
                "filename": filename,
                "content": base64.b64encode(content).decode("ascii"),
            }
        )
    return attachments


def _external_attachment_links(doc: Document) -> str:
    links = [
        (
            f'<li><a href="{html.escape(attachment.link_url, quote=True)}">'
            f"{html.escape(attachment.display_name or attachment.filename)}</a></li>"
        )
        for attachment in doc.attachments
        if attachment.link_url
    ]
    if not links:
        return ""
    return "<p>外部連結附件：</p><ul>" + "".join(links) + "</ul>"


async def queue_document_recipient_emails(
    session: AsyncSession,
    doc: Document,
) -> int:
    """將設定為 Email 的公文受文者排入 outbox，回傳去重後的信箱數量。

    直接指定的 email 使用公文上的快照；機關職位則在正式發文當下解析現任成員，
    讓職務交接後的新任人員可以收到後續公文。
    """
    recipients = [
        recipient
        for recipient in doc.recipients
        if recipient.delivery_method == DeliveryMethod.EMAIL
    ]
    if not recipients:
        return 0

    recipients_by_email: dict[str, _EmailRecipient] = {}

    target_user_recipients: dict[uuid.UUID, list[DocumentRecipient]] = defaultdict(list)
    for recipient in recipients:
        if recipient.target_user_id:
            target_user_recipients[recipient.target_user_id].append(recipient)

    target_user_ids = set(target_user_recipients)
    if target_user_ids:
        users = (
            await session.execute(
                select(User.id, User.email).where(
                    User.id.in_(target_user_ids),
                    User.is_active.is_(True),
                )
            )
        ).all()
        for user_id, email in users:
            for recipient in target_user_recipients[user_id]:
                _add_recipient_email(recipients_by_email, email, recipient)

    for recipient in recipients:
        _add_recipient_email(recipients_by_email, recipient.email, recipient)

    position_recipients: dict[uuid.UUID, list[DocumentRecipient]] = defaultdict(list)
    for recipient in recipients:
        for position_id in recipient.email_position_ids:
            position_recipients[uuid.UUID(str(position_id))].append(recipient)
    position_ids = set(position_recipients)
    if position_ids:
        users = (
            await session.execute(
                select(User.email, UserPosition.position_id)
                .join(UserPosition, UserPosition.user_id == User.id)
                .where(
                    UserPosition.position_id.in_(position_ids),
                    *active_tenure_filter(local_today()),
                    User.is_active.is_(True),
                    User.email.is_not(None),
                    User.email != "",
                )
                .distinct()
            )
        ).all()
        for email, position_id in users:
            for recipient in position_recipients[position_id]:
                _add_recipient_email(recipients_by_email, email, recipient)

    if not recipients_by_email:
        return 0

    emails = list(recipients_by_email)
    base_url = settings.FRONTEND_BASE_URL.rstrip("/")
    document_url = f"{base_url}/documents/{doc.id}"
    safe_title = html.escape(doc.title)
    safe_serial = html.escape(str(doc.serial_number or ""))
    body = (
        f"<p>您有一份新的公文通知。</p>"
        f"<p><strong>{safe_title}</strong><br>字號：{safe_serial}</p>"
        f'<p><a href="{html.escape(document_url, quote=True)}">前往查看公文</a></p>'
    )
    if doc.attachments:
        body += "<p>公文下載版與附件已隨信附上。</p>" + _external_attachment_links(doc)
        grouped_recipients: dict[tuple[str, str], list[_EmailRecipient]] = defaultdict(list)
        for delivery in recipients_by_email.values():
            group_key = (_copy_mark(delivery.recipient), delivery.recipient.name)
            grouped_recipients[group_key].append(delivery)
        for deliveries in grouped_recipients.values():
            recipient = deliveries[0].recipient
            grouped_emails = [delivery.email for delivery in deliveries]
            attachment_payload = await _build_document_email_attachments(session, doc, recipient)
            await emit(
                session,
                event_type="email.send",
                payload={
                    "to": grouped_emails,
                    "subject": f"【公文通知】{doc.title}",
                    "body": body,
                    "subtype": "html",
                    "attachments": attachment_payload,
                },
            )
    else:
        await emit(
            session,
            event_type="email.send",
            payload={
                "to": emails,
                "subject": f"【公文通知】{doc.title}",
                "body": body,
                "subtype": "html",
            },
        )
    return len(emails)
