"""法規巡檢 Celery 任務。"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import or_, select

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _sync_due_sources() -> dict:
    from api.core.cache import cache_invalidate
    from api.core.database import task_session
    from api.models.regulation_sync import RegulationSyncSource
    from api.services.dashboard import invalidate_dashboard_cache
    from api.services.regulation_sync import synchronize_source

    async with task_session() as session:
        ids = list(
            (
                await session.scalars(
                    select(RegulationSyncSource.id).where(
                        or_(
                            RegulationSyncSource.requested_at.is_not(None),
                            RegulationSyncSource.next_sync_at <= datetime.now(UTC),
                        )
                    )
                )
            ).all()
        )
    completed = 0
    for source_id in ids:
        async with task_session() as session:
            try:
                result = await synchronize_source(session, uuid.UUID(str(source_id)))
                await session.commit()
                if result is not None:
                    # 提交後才清快取，避免其他請求在交易前重新填入舊法規。
                    await cache_invalidate("reg:public:v1:org:*")
                    await invalidate_dashboard_cache()
                completed += result is not None
            except Exception:
                await session.rollback()
                raise
    return {"completed": completed}


@celery_app.task(
    name="api.services.regulation_tasks.sync_regulation_sources",
    bind=True,
    max_retries=2,
    soft_time_limit=840,
    time_limit=900,
)
def sync_regulation_sources(self) -> dict:  # noqa: ANN001
    try:
        return asyncio.run(_sync_due_sources())
    except Exception as exc:
        raise self.retry(exc=exc, countdown=300) from exc


@celery_app.task(
    name="api.services.regulation_tasks.audit_regulation_consistency", bind=True, max_retries=1
)
def audit_regulation_consistency(self) -> dict:  # noqa: ANN001
    """每日巡檢法規狀態與公布令一致性。"""

    async def _run() -> dict:
        from api.core.database import task_session
        from api.services.regulation_consistency import audit_regulation_document_consistency

        async with task_session() as session:
            try:
                result = await audit_regulation_document_consistency(session)
                await session.commit()
                return result
            except Exception:
                await session.rollback()
                raise

    try:
        result = asyncio.run(_run())
        if result.get("problem_count", 0) > 0:
            logger.warning("[Regulation Audit] 發現 %s 筆不一致資料", result["problem_count"])
        else:
            logger.info("[Regulation Audit] 一致性檢查完成，未發現異常")
        return result
    except Exception as exc:
        logger.error("[Regulation Audit] 巡檢失敗: %s", exc)
        raise self.retry(exc=exc, countdown=300) from exc
