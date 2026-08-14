"""跨模組通知服務。

通知由路由與背景服務共同觸發，因此實作必須位於 service 層，不能反向依賴
notifications router。
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.ws_manager import manager as ws_manager
from api.email.renderer import make_unsubscribe_token
from api.email.sender import send_branded_email
from api.models.notification import Notification
from api.models.user import User
from api.services.discord_notification_routes import emit_personal_notification
from api.services.notification_pref import TYPE_LABELS, normalize_preferences
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
) -> None:
    """依使用者偏好建立站內通知並（若開啟）寄送品牌 Email。"""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        return

    channel = normalize_preferences(user.notification_preferences).get(
        type, {"inapp": True, "email": False}
    )
    if channel["inapp"]:
        notification = Notification(
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            link=link,
            related_id=related_id,
        )
        db.add(notification)
        await db.flush()
        try:
            unread = await db.scalar(
                select(func.count(Notification.id))
                .where(Notification.user_id == user_id)
                .where(Notification.is_read == False)  # noqa: E712
            )
            await ws_manager.broadcast_to_room(
                f"user:{user_id}",
                {
                    "type": "notification.created",
                    "notification": _notification_payload(notification),
                    "unread": int(unread or 0),
                },
            )
        except Exception:
            logger.warning("通知 WebSocket 推送失敗 user=%s type=%s", user_id, type, exc_info=True)
        try:
            await send_to_user(
                db,
                user_id,
                {"title": title, "body": body or "", "url": link or "/notifications"},
            )
        except Exception:
            logger.warning("通知 Web Push 推送失敗 user=%s type=%s", user_id, type, exc_info=True)

    if channel["email"] and user.email:
        try:
            _send_notification_email(user, type, title, body, link)
        except Exception:
            logger.warning("通知 Email 排程失敗 user=%s type=%s", user_id, type, exc_info=True)

    if channel.get("line"):
        try:
            from api.models.line_account import LineAccountLink
            from api.services.outbox import emit

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
                    payload={
                        "line_user_id": line_user_id,
                        "title": title,
                        "body": body,
                        "link": link,
                    },
                )
        except Exception:
            logger.warning("通知 LINE 排程失敗 user=%s type=%s", user_id, type, exc_info=True)

    if channel.get("discord"):
        try:
            await emit_personal_notification(
                db,
                user_id=user_id,
                notification_type=type,
                title=title,
                body=body,
                link=link,
            )
        except Exception:
            logger.warning("通知 Discord 排程失敗 user=%s type=%s", user_id, type, exc_info=True)
