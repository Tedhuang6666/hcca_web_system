"""工作分配期限提醒 Celery task。"""

from __future__ import annotations

import asyncio

from api.core.celery_app import celery_app
from api.core.database import AsyncSessionLocal
from api.services.work_item import remind_due_work_items


@celery_app.task(name="api.services.work_item_tasks.remind_due_work_items")
def remind_due_work_items_task() -> int:
    async def _run() -> int:
        async with AsyncSessionLocal() as session:
            count = await remind_due_work_items(session)
            await session.commit()
            return count

    return asyncio.run(_run())
