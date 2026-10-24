"""Web Push delivery helpers."""

from __future__ import annotations

import asyncio
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
    """推送至所有有效訂閱；暫時失敗交由外層 outbox 重試。

    多裝置部分成功時，重試可能再次推送已成功的裝置（at-least-once）。
    訂閱狀態與最近使用時間仍由呼叫端的交易管理。
    """
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
    first_error: Exception | None = None
    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info=subscription_info,
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
            )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in {404, 410}:
                sub.is_active = False
            elif first_error is None:
                first_error = exc
            logger.warning("Web push delivery failed status=%s", status_code)
            continue
        except Exception as exc:
            # 網路層例外也可能不包成 WebPushException；其他裝置仍應有發送機會。
            if first_error is None:
                first_error = exc
            logger.warning("Web push transport failed type=%s", type(exc).__name__)
            continue
        sub.mark_used()
        sent += 1
    await db.flush()
    if first_error is not None:
        raise first_error
    return sent
