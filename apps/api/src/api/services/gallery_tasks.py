"""沿用 task_session 與 asyncio bridge 執行活動照片同步。"""

import asyncio

from api.core.celery_app import celery_app


async def _sync_gallery() -> dict:
    from api.core.cache import cache_invalidate
    from api.core.database import task_session
    from api.services.gallery_sync import synchronize

    async with task_session() as session:
        report = await synchronize(session)
        await session.commit()
        if report is not None:
            await cache_invalidate("site:public")
    return {"completed": report is not None}


@celery_app.task(
    name="api.services.gallery_tasks.sync_gallery",
    bind=True,
    max_retries=2,
    soft_time_limit=840,
    time_limit=900,
)
def sync_gallery(self) -> dict:  # noqa: ANN001
    try:
        return asyncio.run(_sync_gallery())
    except Exception as exc:
        raise self.retry(exc=exc, countdown=300) from exc
