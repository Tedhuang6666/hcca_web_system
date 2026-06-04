"""權限相關背景任務 — 清除過期任期使用者的 RBAC 快取，確保任期到期後即時失效。"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from api.core.cache import cache_invalidate_user_permissions
from api.core.celery_app import celery_app
from api.core.clock import local_today
from api.core.config import settings
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
    today = local_today()
    engine = create_async_engine(str(settings.DATABASE_URL))
    user_ids: set[str] = set()
    try:
        async with AsyncSession(engine) as session:
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
    finally:
        await engine.dispose()

    for uid in user_ids:
        await cache_invalidate_user_permissions(uid)

    logger.info("invalidated permission caches users=%d", len(user_ids))
    return {"invalidated": len(user_ids)}
