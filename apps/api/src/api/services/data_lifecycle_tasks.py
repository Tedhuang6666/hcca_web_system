"""資料生命週期 Celery 任務 — 自動執行 safe 規則。

只跑 danger_level='safe' 的規則；其他規則保留為人類在 /admin/lifecycle 上手動觸發，
避免不可恢復的批次清理在無人值守時意外執行。

每次執行寫一筆 audit 與 logger.info，失敗會在 Discord 告警頻道推送（複用 backup_tasks
的 _emit_backup_alert_sync 模式，但簡化為內聯）。
"""

from __future__ import annotations

import asyncio
import logging

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="api.services.data_lifecycle_tasks.run_safe_purges",
    bind=True,
    max_retries=1,
    default_retry_delay=600,
)
def run_safe_purges(self) -> dict:  # type: ignore[type-arg]
    """掃所有 danger_level='safe' 規則並以預設保留天數執行清理。"""
    try:
        return asyncio.run(_run())
    except Exception as exc:
        logger.exception("run_safe_purges failed")
        raise self.retry(exc=exc) from exc


async def _run() -> dict:
    from api.core.database import task_session
    from api.services import data_lifecycle as svc

    results: list[dict] = []
    async with task_session() as session:
        for rule in svc.RULES:
            if rule.danger_level != "safe":
                continue
            try:
                result = await svc.execute(session, rule_id=rule.id)
                results.append(
                    {
                        "rule_id": rule.id,
                        "action": result.action,
                        "matched": result.matched_count,
                        "archived": result.archived_count,
                        "purged": result.purged_count,
                    }
                )
            except Exception:
                logger.exception("safe purge failed rule=%s", rule.id)
                results.append({"rule_id": rule.id, "error": True})
        await session.commit()
    logger.info("data_lifecycle.run_safe_purges done results=%s", results)
    return {"results": results}
