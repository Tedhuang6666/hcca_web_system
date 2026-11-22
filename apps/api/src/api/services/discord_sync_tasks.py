"""Discord 成員角色與暱稱定期對帳。"""

from __future__ import annotations

import asyncio

from api.core.celery_app import celery_app
from api.core.database import task_session
from api.services.discord_bot import enqueue_all_role_sync


@celery_app.task(
    name="api.services.discord_sync_tasks.reconcile_members",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def reconcile_members(self) -> dict:  # type: ignore[type-arg]
    return asyncio.run(_reconcile_members())


async def _reconcile_members() -> dict:
    async with task_session() as db:
        queued = await enqueue_all_role_sync(db)
        await db.commit()
    return {"queued": queued}
