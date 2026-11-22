"""權限相關背景任務 — 清除過期任期使用者的 RBAC 快取，確保任期到期後即時失效。"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from api.core.cache import cache_invalidate_user_permissions
from api.core.celery_app import celery_app
from api.core.clock import local_today
from api.core.database import task_session
from api.models.notification import Notification
from api.models.org import UserPosition

logger = logging.getLogger(__name__)


@celery_app.task(
    name="api.services.permission_tasks.invalidate_expired_user_caches",
    bind=True,
    max_retries=0,
)
def invalidate_expired_user_caches(self) -> dict:  # type: ignore[type-arg]
    """掃今天「剛失效」的 UserPosition，清掉對應使用者的 perm cache。"""
    return asyncio.run(_invalidate_async())


async def _invalidate_async() -> dict:
    # notification service 會排入本 task 的 email 批次，延遲匯入避免循環依賴。
    from api.services.notification import create_notification

    today = local_today()
    user_ids: set[str] = set()
    async with task_session() as session:
        rows = (
            (
                await session.execute(
                    select(UserPosition.user_id).where(
                        UserPosition.end_date.is_not(None),
                        UserPosition.end_date < today,
                    )
                )
            )
            .scalars()
            .all()
        )
        user_ids = {str(uid) for uid in rows}
        expired_rows = (
            await session.execute(
                select(UserPosition.id, UserPosition.user_id).where(
                    UserPosition.end_date == today - timedelta(days=1),
                )
            )
        ).all()
        expired_ids = [position_id for position_id, _ in expired_rows]
        already_notified = set()
        if expired_ids:
            already_notified = set(
                (
                    await session.scalars(
                        select(Notification.related_id).where(
                            Notification.type == "system",
                            Notification.title == "你的職位任期已結束",
                            Notification.related_id.in_(expired_ids),
                        )
                    )
                ).all()
            )
        for position_id, user_id in expired_rows:
            if position_id in already_notified:
                continue
            await create_notification(
                session,
                user_id=user_id,
                type="system",
                title="你的職位任期已結束",
                body="系統已更新你的可用功能。若認為有誤，請聯絡組織管理員。",
                link="/notifications",
                related_id=position_id,
                email_allowed=False,
            )
        await session.commit()

    for uid in user_ids:
        await cache_invalidate_user_permissions(uid)

    logger.info("invalidated permission caches users=%d", len(user_ids))
    return {"invalidated": len(user_ids)}
