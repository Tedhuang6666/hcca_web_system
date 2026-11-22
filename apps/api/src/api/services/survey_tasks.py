"""問卷系統 Celery 定時任務。"""

from __future__ import annotations

import asyncio
import logging

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="api.services.survey_tasks.close_expired_surveys",
    bind=True,
    max_retries=3,
)
def close_expired_surveys(self) -> dict:  # noqa: ANN001
    """每分鐘關閉已超過 closes_at 的開放問卷。"""

    async def _run() -> int:
        from api.core.database import task_session
        from api.services import survey as survey_svc

        async with task_session() as session:
            try:
                closed_count = await survey_svc.close_expired_surveys(session)
                await session.commit()
                return closed_count
            except Exception:
                await session.rollback()
                raise

    try:
        count = asyncio.run(_run())
        if count:
            logger.info("[Celery Beat] 自動關閉問卷 %d 份", count)
        return {"closed": count}
    except Exception as exc:
        logger.error("[Celery Beat] 自動關閉問卷失敗: %s", exc)
        raise self.retry(exc=exc, countdown=60) from exc
