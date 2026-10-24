"""跨模組通知服務。

通知由路由與背景服務共同觸發，因此實作必須位於 service 層，不能反向依賴
notifications router。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.ws_manager import publish_room_from_worker
from api.email.renderer import make_unsubscribe_token
from api.email.sender import send_branded_email
from api.models.notification import Notification
from api.models.user import User
from api.services.discord_notification_routes import emit_personal_notification
from api.services.notification_pref import TYPE_LABELS, get_digest_frequency, normalize_preferences
from api.services.notification_tasks import (
    NOTIFICATION_EMAIL_BATCH_DELAY_SECONDS,
    send_notification_email_batch,
)
from api.services.web_push import send_to_user

logger = logging.getLogger(__name__)


def _send_notification_email(
    user: User, ntype: str, title: str, body: str | None, link: str | None
) -> None:
    """渲染品牌通知信並排入寄送佇列（含退訂連結）。"""
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    token = make_unsubscribe_token(user.id, ntype)
    send_branded_email(
        to=[user.email],
        subject=f"【{TYPE_LABELS.get(ntype, '通知')}】{title}",
        template="notification",
        context={
            "heading": title,
            "body_text": body or "",
            "preview_text": (body or title)[:80],
            "cta_url": f"{base}{link}" if link else "",
            "cta_label": "前往查看",
            "unsubscribe_url": f"{base}/unsubscribe?token={token}",
        },
        recipient_metadata=[
            {"user_id": str(user.id), "email": user.email, "name": user.display_name}
        ],
        source="notification",
    )


def _notification_payload(notification: Notification) -> dict[str, object]:
    return {
        "id": str(notification.id),
        "type": notification.type,
        "title": notification.title,
        "body": notification.body,
        "link": notification.link,
        "is_read": notification.is_read,
        "related_id": str(notification.related_id) if notification.related_id else None,
        "created_at": notification.created_at.isoformat(),
    }


async def create_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    related_id: uuid.UUID | None = None,
    email_allowed: bool = True,
    email_attachment_ids: list[uuid.UUID] | None = None,
) -> None:
    """依使用者偏好建立通知；email_allowed 可讓事件停用 Email 管道。"""
    from api.services.outbox import emit, request_processing_after_commit

    user = await db.get(User, user_id)
    if user is None:
        return
    channel = normalize_preferences(user.notification_preferences).get(
        type, {"inapp": True, "email": False}
    )
    digest_enabled = get_digest_frequency(user.notification_preferences) != "off"
    email_enabled = channel["email"] and email_allowed
    notification: Notification | None = None
    queued = False
    if channel["inapp"] or email_enabled:
        notification = Notification(
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            link=link,
            related_id=related_id,
            is_inapp_visible=channel["inapp"],
            # 禁止寄信的站內通知也不能被另一筆同類聚合／摘要信撈入。
            email_queued_at=None if email_enabled else datetime.now(UTC),
        )
        db.add(notification)
        await db.flush()
        if channel["inapp"]:
            for event_type in ("notification.websocket", "notification.web_push"):
                await emit(
                    db, event_type=event_type, payload={"notification_id": str(notification.id)}
                )
            queued = True

    if email_enabled and user.email and notification is not None:
        if email_attachment_ids:
            notification.email_queued_at = datetime.now(UTC)
            await emit(
                db,
                event_type="notification.email_with_attachments",
                payload={
                    "user_id": str(user_id),
                    "type": type,
                    "title": title,
                    "body": body or "",
                    "link": link,
                    "related_id": str(related_id) if related_id else None,
                    "attachment_ids": [str(item) for item in email_attachment_ids],
                },
            )
            queued = True
        elif not digest_enabled:
            await emit(
                db,
                event_type="notification.email_batch",
                payload={"notification_id": str(notification.id)},
            )
            queued = True

    if channel.get("line"):
        from api.models.line_account import LineAccountLink

        line_user_id = await db.scalar(
            select(LineAccountLink.line_user_id).where(
                LineAccountLink.user_id == user_id,
                LineAccountLink.is_active.is_(True),
            )
        )
        if line_user_id:
            await emit(
                db,
                event_type="line.push",
                payload={"line_user_id": line_user_id, "title": title, "body": body, "link": link},
            )
            queued = True
    if channel.get("discord"):
        await emit_personal_notification(
            db,
            user_id=user_id,
            notification_type=type,
            title=title,
            body=body,
            link=link,
        )
    if queued:
        request_processing_after_commit(db)


async def deliver_notification(
    db: AsyncSession, event_type: str, payload: dict[str, object]
) -> None:
    """只在 outbox worker 的獨立交易中讀取已提交通知，再執行外部管道。"""
    try:
        notification_id = uuid.UUID(str(payload["notification_id"]))
    except (KeyError, TypeError, ValueError):
        logger.warning("通知傳遞事件缺少有效 notification_id type=%s", event_type)
        return
    notification = await db.get(Notification, notification_id)
    if notification is None:
        return
    user = await db.get(User, notification.user_id)
    if user is None or not user.is_active:
        return
    channel = normalize_preferences(user.notification_preferences).get(
        notification.type, {"inapp": True, "email": False}
    )
    if event_type == "notification.email_batch":
        if (
            not channel["email"]
            or not user.email
            or notification.email_queued_at is not None
            or get_digest_frequency(user.notification_preferences) != "off"
        ):
            return
        await asyncio.to_thread(
            send_notification_email_batch.apply_async,
            args=[str(user.id), notification.type],
            countdown=NOTIFICATION_EMAIL_BATCH_DELAY_SECONDS,
        )
        return
    if not notification.is_inapp_visible or not channel["inapp"]:
        return
    if event_type == "notification.websocket":
        unread = await db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id,
                Notification.is_inapp_visible.is_(True),
                Notification.is_read.is_(False),
            )
        )
        await publish_room_from_worker(
            f"user:{user.id}",
            {
                "type": "notification.created",
                "notification": _notification_payload(notification),
                "unread": int(unread or 0),
            },
        )
    elif event_type == "notification.web_push":
        await send_to_user(
            db,
            user.id,
            {
                "title": notification.title,
                "body": notification.body or "",
                "url": notification.link or "/notifications",
            },
        )


async def notify_users(
    db: AsyncSession,
    *,
    user_ids: Iterable[uuid.UUID],
    type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    related_id: uuid.UUID | None = None,
    exclude_user_ids: Iterable[uuid.UUID] = (),
) -> None:
    """對一組收件人依各自偏好建立通知，並避免同一事件重複通知。"""
    excluded = set(exclude_user_ids)
    for user_id in dict.fromkeys(user_ids):
        if user_id in excluded:
            continue
        await create_notification(
            db,
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            link=link,
            related_id=related_id,
        )
