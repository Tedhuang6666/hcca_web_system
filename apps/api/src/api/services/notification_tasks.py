"""通知 Email 短延遲聚合任務。

同一使用者、同一通知類型在短時間內產生多筆事件時，只建立一筆 EmailMessage，
並在信件內列出所有事件，避免校商投稿或陳情更新連續轟炸收件匣。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.core.celery_app import celery_app
from api.core.config import settings
from api.core.database import task_session
from api.email.renderer import make_unsubscribe_token
from api.email.sender import send_branded_email
from api.models.notification import Notification
from api.models.user import User
from api.services.notification_pref import TYPE_LABELS, get_digest_frequency, normalize_preferences

logger = logging.getLogger(__name__)

# 給同一類型的連續事件留出完整的合併窗口；任務到期時一次收集最近 15 分鐘的通知。
NOTIFICATION_EMAIL_BATCH_DELAY_SECONDS = 5 * 60
_NOTIFICATION_EMAIL_BATCH_LOOKBACK_SECONDS = 15 * 60
_NOTIFICATION_EMAIL_BATCH_LIMIT = 100


@dataclass(frozen=True)
class _NotificationEmailItem:
    title: str
    body: str | None
    link: str | None


@dataclass(frozen=True)
class _NotificationEmailBatch:
    user_id: uuid.UUID
    email: str
    name: str | None
    notification_type: str
    notification_ids: tuple[uuid.UUID, ...]
    items: tuple[_NotificationEmailItem, ...]


def _absolute_link(link: str | None) -> str:
    if not link:
        return ""
    if link.startswith(("http://", "https://")):
        return link
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    return f"{base}{link if link.startswith('/') else '/' + link}"


async def _claim_notification_batch(
    user_id: uuid.UUID, notification_type: str
) -> _NotificationEmailBatch | None:
    cutoff = datetime.now(UTC) - timedelta(seconds=_NOTIFICATION_EMAIL_BATCH_LOOKBACK_SECONDS)
    async with task_session() as session:
        user = await session.get(User, user_id)
        if user is None or not user.is_active or not user.email:
            return None
        if get_digest_frequency(user.notification_preferences) != "off":
            return None
        preferences = normalize_preferences(user.notification_preferences)
        if not preferences.get(notification_type, {}).get("email", False):
            return None

        result = await session.execute(
            select(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.type == notification_type,
                Notification.email_queued_at.is_(None),
                Notification.created_at >= cutoff,
            )
            .order_by(Notification.created_at)
            .limit(_NOTIFICATION_EMAIL_BATCH_LIMIT)
            .with_for_update(skip_locked=True)
        )
        notifications = list(result.scalars().all())
        if not notifications:
            return None

        queued_at = datetime.now(UTC)
        for notification in notifications:
            notification.email_queued_at = queued_at
        await session.commit()
        return _NotificationEmailBatch(
            user_id=user.id,
            email=str(user.email),
            name=user.display_name,
            notification_type=notification_type,
            notification_ids=tuple(notification.id for notification in notifications),
            items=tuple(
                _NotificationEmailItem(notification.title, notification.body, notification.link)
                for notification in notifications
            ),
        )


async def _release_notification_batch(batch: _NotificationEmailBatch) -> None:
    async with task_session() as session:
        notifications = (
            await session.execute(
                select(Notification).where(Notification.id.in_(batch.notification_ids))
            )
        ).scalars()
        for notification in notifications:
            notification.email_queued_at = None
        await session.commit()


def _build_batch_message(batch: _NotificationEmailBatch) -> tuple[str, dict[str, str]]:
    label = TYPE_LABELS.get(batch.notification_type, "通知")
    count = len(batch.items)
    subject = f"【{label}】{batch.items[0].title}" if count == 1 else f"【{label}】{count} 則通知"
    body_parts: list[str] = []
    for item in batch.items:
        detail = item.title
        if item.body:
            detail += f"\n{item.body}"
        if item.link:
            detail += f"\n查看：{_absolute_link(item.link)}"
        body_parts.append(detail)
    body_text = "\n\n".join(body_parts)
    return subject, {
        "heading": subject,
        "body_text": body_text,
        "preview_text": body_text[:120],
        "cta_url": f"{settings.FRONTEND_BASE_URL.rstrip('/')}/notifications",
        "cta_label": "查看通知",
        "unsubscribe_url": (
            f"{settings.FRONTEND_BASE_URL.rstrip('/')}/unsubscribe?token="
            f"{make_unsubscribe_token(batch.user_id, batch.notification_type)}"
        ),
    }


async def _send_notification_batch(user_id: uuid.UUID, notification_type: str) -> dict[str, int]:
    batch = await _claim_notification_batch(user_id, notification_type)
    if batch is None:
        return {"sent": 0}
    subject, context = _build_batch_message(batch)
    try:
        send_branded_email(
            to=[batch.email],
            subject=subject,
            template="notification",
            context=context,
            recipient_metadata=[
                {
                    "user_id": str(batch.user_id),
                    "email": batch.email,
                    "name": batch.name,
                }
            ],
            source="notification",
        )
    except Exception:
        try:
            await _release_notification_batch(batch)
        except Exception:
            logger.warning("通知 Email 批次標記回復失敗", exc_info=True)
        logger.warning(
            "通知 Email 批次排程失敗 user=%s type=%s count=%d",
            user_id,
            notification_type,
            len(batch.items),
            exc_info=True,
        )
        raise
    return {"sent": 1, "notifications": len(batch.items)}


@celery_app.task(
    name="api.services.notification_tasks.send_notification_email_batch",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
def send_notification_email_batch(self, user_id: str, notification_type: str) -> dict[str, int]:  # noqa: ARG001
    """延遲聚合同一使用者、同一類型的通知，再只排入一封 Email。"""
    return asyncio.run(_send_notification_batch(uuid.UUID(user_id), notification_type))
