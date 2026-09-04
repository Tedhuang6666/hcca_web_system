"""公文正式發文後的電子郵件遞送。"""

from __future__ import annotations

import html
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.config import settings
from api.models.document import DeliveryMethod, Document
from api.models.org import UserPosition
from api.models.user import User
from api.services.outbox import emit
from api.services.permission import active_tenure_filter


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

    emails: list[str] = []
    seen: set[str] = set()

    def add_email(value: str | None) -> None:
        normalized = (value or "").strip().lower()
        if normalized and normalized not in seen:
            seen.add(normalized)
            emails.append(normalized)

    target_user_ids = {
        recipient.target_user_id for recipient in recipients if recipient.target_user_id
    }
    if target_user_ids:
        users = (
            (
                await session.execute(
                    select(User.email).where(
                        User.id.in_(target_user_ids),
                        User.is_active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        for email in users:
            add_email(email)

    for recipient in recipients:
        add_email(recipient.email)

    position_ids = {
        uuid.UUID(str(position_id))
        for recipient in recipients
        for position_id in recipient.email_position_ids
    }
    if position_ids:
        users = (
            (
                await session.execute(
                    select(User.email)
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
            )
            .scalars()
            .all()
        )
        for email in users:
            add_email(email)

    if not emails:
        return 0

    base_url = settings.FRONTEND_BASE_URL.rstrip("/")
    document_url = f"{base_url}/documents/{doc.id}"
    safe_title = html.escape(doc.title)
    safe_serial = html.escape(doc.serial_number)
    body = (
        f"<p>您有一份新的公文通知。</p>"
        f"<p><strong>{safe_title}</strong><br>字號：{safe_serial}</p>"
        f'<p><a href="{html.escape(document_url, quote=True)}">前往查看公文</a></p>'
    )
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
