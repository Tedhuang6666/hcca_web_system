"""法規巡檢 Celery 任務。"""

from __future__ import annotations

import asyncio
import logging

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="api.services.regulation_tasks.audit_regulation_consistency", bind=True, max_retries=1
)
def audit_regulation_consistency(self) -> dict:  # noqa: ANN001
    """每日巡檢法規狀態與公布令一致性。"""

    async def _run() -> dict:
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

        from api.core.config import settings
        from api.services.regulation_consistency import audit_regulation_document_consistency

        engine = create_async_engine(str(settings.DATABASE_URL), echo=False)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            try:
                result = await audit_regulation_document_consistency(session)
                await session.commit()
                return result
            except Exception:
                await session.rollback()
                raise
            finally:
                await engine.dispose()

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
