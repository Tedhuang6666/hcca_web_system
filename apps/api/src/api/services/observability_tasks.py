# ruff: noqa: E702
import asyncio

from celery import shared_task

from api.core.database import task_session
from api.services.observability import collect_crux_daily, collect_pagespeed


@shared_task(name="api.services.observability_tasks.collect_pagespeed_scheduled")
def collect_pagespeed_scheduled() -> dict:
    async def run():
        async with task_session() as session:
            result = await collect_pagespeed(session)
            await session.commit()
            return result

    return asyncio.run(run())


@shared_task(name="api.services.observability_tasks.collect_crux_daily")
def collect_crux_daily_scheduled() -> dict:
    async def run():
        async with task_session() as session:
            result = await collect_crux_daily(session)
            await session.commit()
            return result

    return asyncio.run(run())
