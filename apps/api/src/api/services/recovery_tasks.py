"""模組自動恢復排程任務（Celery beat）。

每 30s 掃 Redis ZSET module_probe_queue，對已到期的模組執行 half-open 探測；
通過則解除維護，失敗則延長 cooldown 並排下一輪。
"""

from __future__ import annotations

import asyncio
import logging

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="api.services.recovery_tasks.process_half_open_probes")
def process_half_open_probes() -> dict[str, int | list[str]]:
    """同步入口，內部以 asyncio.run 跑非同步邏輯。

    回傳：{"probed": N, "recovered": [...], "still_down": [...]}
    """
    try:
        return asyncio.run(_run())
    except Exception:
        logger.exception("process_half_open_probes failed")
        return {"probed": 0, "recovered": [], "still_down": []}


async def _run() -> dict[str, int | list[str]]:
    from api.core.module_recovery import attempt_recovery, pop_due_probes

    ids = await pop_due_probes(max_items=5)
    if not ids:
        return {"probed": 0, "recovered": [], "still_down": []}

    recovered: list[str] = []
    still_down: list[str] = []
    for mid in ids:
        try:
            ok = await attempt_recovery(mid)
        except Exception:
            logger.exception("attempt_recovery raised mid=%s", mid)
            ok = False
        (recovered if ok else still_down).append(mid)
    logger.info(
        "half-open probes: probed=%d recovered=%s still_down=%s",
        len(ids),
        recovered,
        still_down,
    )
    return {"probed": len(ids), "recovered": recovered, "still_down": still_down}
