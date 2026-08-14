"""電子郵件收件人解析與寄送佇列服務。

這裡保留可由 API router 與 Celery task 共用的寄送流程，避免背景工作反向
匯入 router。
"""

from __future__ import annotations

import base64
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.config import settings
from api.email.renderer import (
    build_personalization_context,
    validate_required_variables,
)
from api.email.sender import enqueue_rendered, render_generic_message, render_generic_subject
from api.models.email_message import (
    EmailAttachment,
    EmailAttachmentMode,
    EmailCampaignRecipient,
    EmailMessage,
    EmailRecipientListMember,
    EmailRecipientStatus,
    EmailStatus,
    EmailSuppression,
)
from api.models.user import User
from api.services.recipient import resolve_recipients, spec_to_resolve_kwargs
from api.services.storage import get_storage


@dataclass
class PersonalizedRecipient:
    user_id: uuid.UUID | None
    email: str
    name: str | None
    student_id: str | None
    variables: dict[str, str]


def normalize_external_emails(values: list[str]) -> list[str]:
    emails: list[str] = []
    seen: set[str] = set()
    for value in values:
        email = str(value).strip().lower()
        if email and email not in seen:
            seen.add(email)
            emails.append(email)
    return emails


def _merged_custom_variables(
    definitions: list[dict], defaults: dict[str, str], recipient_vars: dict[str, str]
) -> dict[str, str]:
    allowed = {str(item["key"]) for item in definitions}
    merged = {str(item["key"]): str(item.get("default_value") or "") for item in definitions}
    merged.update({key: str(value) for key, value in defaults.items() if key in allowed})
    merged.update({key: str(value) for key, value in recipient_vars.items() if key in allowed})
    return merged


def _make_personalization_context(row: PersonalizedRecipient) -> dict:
    return build_personalization_context(
        user_id=row.user_id,
        name=row.name,
        email=row.email,
        student_id=row.student_id,
        custom_variables=row.variables,
    )


async def resolve_personalized_recipients(
    db: AsyncSession,
    msg: EmailMessage,
) -> list[PersonalizedRecipient]:
    users, emails = await resolve_recipients(db, **spec_to_resolve_kwargs(msg.recipient_spec or {}))
    definitions = list(msg.variable_definitions or [])
    defaults = {str(key): str(value) for key, value in (msg.default_variables or {}).items()}
    inputs = list(msg.recipient_variables or [])
    recipient_list_id = (msg.recipient_spec or {}).get("recipient_list_id")
    if recipient_list_id:
        list_rows = (
            (
                await db.execute(
                    select(EmailRecipientListMember).where(
                        EmailRecipientListMember.list_id == uuid.UUID(str(recipient_list_id))
                    )
                )
            )
            .scalars()
            .all()
        )
        inputs.extend(
            {
                "user_id": str(item.user_id) if item.user_id else None,
                "email": item.email,
                "name": item.name,
                "variables": dict(item.variables or {}),
            }
            for item in list_rows
        )

    by_user_id = {str(row.get("user_id")): row for row in inputs if row.get("user_id")}
    by_email = {
        str(row.get("email", "")).strip().lower(): row
        for row in inputs
        if str(row.get("email", "")).strip()
    }
    rows: list[PersonalizedRecipient] = []
    seen_emails: set[str] = set()
    for user_obj, email in zip(users, emails, strict=False):
        imported = by_user_id.get(str(user_obj.id)) or by_email.get(email.strip().lower()) or {}
        imported_name = str(imported.get("name") or "").strip()
        custom = _merged_custom_variables(
            definitions, defaults, dict(imported.get("variables") or {})
        )
        label = imported_name or user_obj.display_name or email
        try:
            validate_required_variables(definitions, custom, recipient_label=label)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
        normalized_email = email.strip().lower()
        seen_emails.add(normalized_email)
        rows.append(
            PersonalizedRecipient(
                user_id=user_obj.id,
                email=email,
                name=imported_name or user_obj.display_name,
                student_id=user_obj.student_id,
                variables=custom,
            )
        )

    external_inputs: list[dict] = [
        {"email": email, "name": None, "variables": {}}
        for email in normalize_external_emails(
            [str(value) for value in (msg.recipient_spec or {}).get("external_emails", [])]
        )
    ]
    external_inputs.extend(inputs)
    for imported in external_inputs:
        email = str(imported.get("email") or "").strip()
        if not email or email.lower() in seen_emails:
            continue
        custom = _merged_custom_variables(
            definitions, defaults, dict(imported.get("variables") or {})
        )
        label = str(imported.get("name") or email)
        try:
            validate_required_variables(definitions, custom, recipient_label=label)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
        seen_emails.add(email.lower())
        rows.append(
            PersonalizedRecipient(
                user_id=None,
                email=email,
                name=str(imported.get("name") or "") or None,
                student_id=None,
                variables=custom,
            )
        )

    if rows:
        suppressed = set(
            (
                await db.execute(
                    select(EmailSuppression.email).where(
                        EmailSuppression.is_active.is_(True),
                        EmailSuppression.email.in_([row.email.lower() for row in rows]),
                    )
                )
            )
            .scalars()
            .all()
        )
        rows = [row for row in rows if row.email.lower() not in suppressed]
    return rows


async def _check_quota(db: AsyncSession, user: User, count: int) -> None:
    if user.is_superuser:
        return
    today = local_today()
    day_start = datetime(today.year, today.month, today.day, tzinfo=UTC)
    used = await db.scalar(
        select(func.coalesce(func.sum(EmailMessage.recipient_count), 0)).where(
            EmailMessage.sender_id == user.id,
            EmailMessage.status.in_([EmailStatus.QUEUED, EmailStatus.SENT]),
            EmailMessage.created_at >= day_start,
        )
    )
    quota = settings.EMAIL_DAILY_QUOTA_PER_USER
    if int(used or 0) + count > quota:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"超過每日寄送上限（{quota} 人次），今日已使用 {int(used or 0)} 人次",
        )


async def render_attachments(
    attachments: list[EmailAttachment],
) -> tuple[list[dict[str, str]], list[dict]]:
    resend_attachments: list[dict[str, str]] = []
    link_blocks: list[dict] = []
    storage = get_storage()
    for attachment in attachments:
        if attachment.revoked_at or (
            attachment.expires_at and attachment.expires_at <= datetime.now(UTC)
        ):
            continue
        if attachment.delivery_mode == EmailAttachmentMode.ATTACHMENT:
            path = storage.local_path(attachment.storage_key)
            if path and path.exists():
                resend_attachments.append(
                    {
                        "filename": attachment.filename,
                        "content": base64.b64encode(path.read_bytes()).decode(),
                    }
                )
                continue
        url = await storage.get_url(
            attachment.storage_key,
            expires=settings.EMAIL_ATTACHMENT_LINK_EXPIRES_SECONDS,
            disposition="attachment",
            download_name=attachment.filename,
        )
        link_blocks.append({"type": "text", "md": f"[下載附件：{attachment.filename}]({url})"})
    return resend_attachments, link_blocks


async def send_now(
    db: AsyncSession,
    user: User,
    msg: EmailMessage,
    enqueue: Callable[..., list[str]] | None = None,
) -> None:
    """解析收件人、落庫後逐封排入寄送佇列，並更新 msg 狀態。"""
    rows = await resolve_personalized_recipients(db, msg)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="解析後無有效收件人"
        )
    await _check_quota(db, user, len(rows))
    await db.execute(
        delete(EmailCampaignRecipient).where(EmailCampaignRecipient.message_id == msg.id)
    )
    await db.flush()
    recipient_models: list[EmailCampaignRecipient] = []
    for row in rows:
        recipient = EmailCampaignRecipient(
            message_id=msg.id,
            user_id=row.user_id,
            email=row.email,
            name=row.name,
            variables=row.variables,
        )
        db.add(recipient)
        recipient_models.append(recipient)
    await db.flush()
    msg.resolved_emails = [row.email for row in rows]
    msg.recipient_count = len(rows)
    msg.status = EmailStatus.QUEUED
    msg.scheduled_at = None
    msg.error_detail = None
    await db.flush()
    attachments = (
        (await db.execute(select(EmailAttachment).where(EmailAttachment.message_id == msg.id)))
        .scalars()
        .all()
    )
    resend_attachments, link_blocks = await render_attachments(list(attachments))
    render_context = dict(msg.context or {})
    render_context["blocks"] = [*list(render_context.get("blocks", [])), *link_blocks]
    dispatches: list[tuple[PersonalizedRecipient, EmailCampaignRecipient, str, str]] = []
    for row, recipient in zip(rows, recipient_models, strict=True):
        personal = _make_personalization_context(row)
        subject = render_generic_subject(msg.subject, personal)
        html = render_generic_message(msg.subject, msg.body, render_context, personal)
        dispatches.append((row, recipient, subject, html))

    await db.commit()
    task_ids: list[str] = []
    enqueue_errors = 0
    enqueue_fn = enqueue or enqueue_rendered
    for row, recipient, subject, html in dispatches:
        try:
            task_ids.extend(
                enqueue_fn(
                    [row.email],
                    subject,
                    html,
                    str(msg.id),
                    str(recipient.id),
                    resend_attachments or None,
                )
            )
            recipient.celery_task_id = task_ids[-1] if task_ids else None
        except Exception as exc:  # noqa: BLE001
            enqueue_errors += 1
            recipient.status = EmailRecipientStatus.FAILED
            recipient.error_detail = f"無法排入寄送佇列：{str(exc)[:450]}"
    msg.celery_task_id = task_ids[0] if task_ids else None
    if not task_ids:
        msg.status = EmailStatus.FAILED
        msg.error_detail = f"全部收件人無法排入寄送佇列（{enqueue_errors} 人）"
    elif enqueue_errors:
        msg.error_detail = f"部分收件人無法排入寄送佇列（{enqueue_errors} 人）"
    await db.flush()
