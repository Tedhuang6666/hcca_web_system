"""工作分配期限提醒 Celery task。"""

from __future__ import annotations

import asyncio

from api.core.celery_app import celery_app
from api.services.work_item import remind_due_work_items


@celery_app.task(name="api.services.work_item_tasks.remind_due_work_items")
def remind_due_work_items_task() -> int:
    async def _run() -> int:
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
        from sqlalchemy.pool import NullPool

        from api.core.config import settings

        # 每次以新 loop 專屬 engine 開 session 並 dispose，避免共享 async engine 的
        # pooled 連線綁定到已關閉的 loop（got Future attached to a different loop）。
        engine = create_async_engine(str(settings.DATABASE_URL), echo=False, poolclass=NullPool)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            try:
                count = await remind_due_work_items(session)
                await session.commit()
                return count
            finally:
                await engine.dispose()

    return asyncio.run(_run())
