"""Web Push delivery helpers."""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.web_push import WebPushSubscription

logger = logging.getLogger(__name__)


def web_push_enabled() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


async def send_to_user(db: AsyncSession, user_id: object, payload: dict[str, Any]) -> int:
    if not web_push_enabled():
        return 0

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush is not installed; skipping web push")
        return 0

    subscriptions = (
        await db.execute(
            select(WebPushSubscription)
            .where(WebPushSubscription.user_id == user_id)
            .where(WebPushSubscription.is_active.is_(True))
        )
    ).scalars()

    sent = 0
    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
            )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in {404, 410}:
                sub.is_active = False
            logger.warning("Web push delivery failed status=%s", status_code, exc_info=True)
            continue
        sub.mark_used()
        sent += 1
    await db.flush()
    return sent
