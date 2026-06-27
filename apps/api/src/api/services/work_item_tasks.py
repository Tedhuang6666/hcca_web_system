"""工作分配期限提醒 Celery task。"""

from __future__ import annotations

import asyncio

from api.core.celery_app import celery_app
from api.services.work_item import remind_due_work_items


@celery_app.task(name="api.services.work_item_tasks.remind_due_work_items")
def remind_due_work_items_task() -> int:
    async def _run() -> int:
        from api.core.database import task_session

        async with task_session() as session:
            try:
                count = await remind_due_work_items(session)
                await session.commit()
                return count
            except Exception:
                await session.rollback()
                raise

    return asyncio.run(_run())
