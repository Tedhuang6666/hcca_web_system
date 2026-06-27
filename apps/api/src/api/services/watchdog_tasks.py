"""平台健康巡邏 watchdog — 每 10 分鐘巡一次，超門檻發 Discord 告警。

設計：
  - 在 Celery worker 內跑（同步 task），不需 in-process state。
  - 不取代 module_health（那是 per-request 即時跳閘）；這裡專注「會悄悄惡化」的指標。
  - 每個檢查項都用獨立 try/except，單一檢查失敗不影響其他。
  - 為避免每 10 分鐘洗版 Discord，**只在「跨越門檻」當下發**：用 Redis flag
    記憶上次狀態，恢復後也發一次「✅ 解除」訊息。
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import redis.asyncio as aioredis

from api.core.celery_app import celery_app
from api.core.config import settings
from api.core.database import task_session as _task_session

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _task_redis() -> AsyncIterator[aioredis.Redis]:
    """每次 asyncio.run() 以新 loop 專屬 redis client 開／關。

    與 _task_session 同理：api.core.security.redis_client 是模組層級共享連線池，
    首次 await 會把連線綁到當下 event loop。Celery 每次 asyncio.run() 都是新 loop，
    沿用共享 client 會拋 "got Future attached to a different loop"。
    """
    client = aioredis.from_url(
        str(settings.REDIS_URL),
        encoding="utf-8",
        decode_responses=True,
    )
    try:
        yield client
    finally:
        await client.aclose()


# 門檻
_DISK_WARN_PCT = 80.0
_DISK_CRIT_PCT = 90.0
_BACKUP_STALE_HOURS = 36  # 最後一份備份超過此小時 → 告警
_OUTBOX_DEAD_WARN = 50  # dead letter 累積超過此數 → 告警

# Redis flag 前綴（避免重複告警）
_FLAG_PREFIX = "watchdog:fired:"


# ── Public Celery task ─────────────────────────────────────────────────────


@celery_app.task(
    name="api.services.watchdog_tasks.run_watchdog",
    bind=True,
    max_retries=0,
)
def run_watchdog(self) -> dict[str, Any]:  # type: ignore[type-arg]
    """每 10 分鐘執行；回傳檢查摘要供 Flower 觀察。"""
    try:
        return asyncio.run(_run())
    except Exception:
        logger.exception("watchdog run failed")
        return {"ok": False}


# ── 內部實作 ───────────────────────────────────────────────────────────────


async def _run() -> dict[str, Any]:
    results: dict[str, Any] = {}
    results["disk"] = await _check_disk()
    results["backup_freshness"] = await _check_backup_freshness()
    results["outbox_dead"] = await _check_outbox_dead()
    logger.info("watchdog summary=%s", results)
    return results


async def _flag_state(key: str) -> bool:
    """回傳是否已在告警狀態。"""
    try:
        async with _task_redis() as client:
            v = await client.get(_FLAG_PREFIX + key)
        return bool(v)
    except Exception:
        return False


async def _set_flag(key: str, fired: bool) -> None:
    try:
        async with _task_redis() as client:
            if fired:
                await client.set(_FLAG_PREFIX + key, "1", ex=86400)
            else:
                await client.delete(_FLAG_PREFIX + key)
    except Exception:
        logger.debug("set flag failed key=%s", key, exc_info=True)


async def _emit_alert(title: str, body: str) -> None:
    """async 版本：已在 _run 內，可直接 await。"""
    if not settings.MODULE_ALERT_DISCORD_CHANNEL_ID:
        return
    from api.services import outbox

    async with _task_session() as session:
        try:
            await outbox.emit(
                session,
                event_type="discord.channel_alert",
                payload={
                    "channel_id": settings.MODULE_ALERT_DISCORD_CHANNEL_ID,
                    "title": title,
                    "body": body,
                },
            )
            await session.commit()
        except Exception:
            logger.exception("emit watchdog alert failed")
            await session.rollback()


# ── 個別檢查 ───────────────────────────────────────────────────────────────


async def _check_disk() -> dict[str, Any]:
    """檢查 uploads/ 所在磁碟使用率。"""
    target = Path(getattr(settings, "DB_BACKUP_DIR", "uploads/backups")).resolve()
    while not target.exists() and target.parent != target:
        target = target.parent
    try:
        usage = shutil.disk_usage(target)
    except Exception:
        logger.exception("disk usage failed for %s", target)
        return {"ok": False, "error": "disk_usage_failed"}
    pct = usage.used / usage.total * 100 if usage.total else 0.0
    fired = await _flag_state("disk")
    if pct >= _DISK_CRIT_PCT:
        if not fired:
            await _emit_alert(
                title="🚨 磁碟使用率超過 90%",
                body=(
                    f"路徑：{target}\n"
                    f"使用率：{pct:.1f}%\n"
                    f"剩餘：{usage.free / 1024**3:.2f} GB / 共 {usage.total / 1024**3:.2f} GB\n"
                    "下一步：到 /admin/data-lifecycle 清過期紀錄、刪舊備份檔，"
                    "或聯絡學校 IT 擴容。"
                ),
            )
            await _set_flag("disk", True)
    elif pct >= _DISK_WARN_PCT:
        if not fired:
            await _emit_alert(
                title="⚠️ 磁碟使用率超過 80%",
                body=(f"路徑：{target}\n使用率：{pct:.1f}%\n剩餘：{usage.free / 1024**3:.2f} GB"),
            )
            await _set_flag("disk", True)
    else:
        if fired:
            await _emit_alert(
                title="✅ 磁碟使用率已恢復",
                body=f"路徑：{target}\n目前使用率：{pct:.1f}%",
            )
            await _set_flag("disk", False)
    return {"ok": True, "pct": round(pct, 2), "path": str(target)}


async def _check_backup_freshness() -> dict[str, Any]:
    """檢查最新備份檔是否超過 _BACKUP_STALE_HOURS 小時。"""
    backup_dir = Path(getattr(settings, "DB_BACKUP_DIR", "uploads/backups"))
    if not backup_dir.exists():
        return {"ok": True, "skipped": "no_backup_dir"}
    candidates = [
        item
        for pattern in (
            "hcca_backup_*.dump",
            "hcca_backup_*.dump.gpg",
            "hcca_backup_*.sql.gz",
            "hcca_backup_*.sql.gz.gpg",
        )
        for item in backup_dir.glob(pattern)
    ]
    if not candidates:
        # 真的沒備份檔 → 一次性告警（首次跑、或新環境）
        fired = await _flag_state("backup_missing")
        if not fired:
            await _emit_alert(
                title="⚠️ 找不到任何備份檔",
                body=(
                    f"目錄：{backup_dir}\n"
                    "確認 DB_BACKUP_ENABLED=true 且 Celery beat 有跑 "
                    "backup_database 任務（每日 03:00）。"
                ),
            )
            await _set_flag("backup_missing", True)
        return {"ok": False, "issue": "no_files"}

    await _set_flag("backup_missing", False)
    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    age_hours = (
        datetime.now(UTC) - datetime.fromtimestamp(latest.stat().st_mtime, UTC)
    ) / timedelta(hours=1)
    fired = await _flag_state("backup_stale")
    if age_hours > _BACKUP_STALE_HOURS:
        if not fired:
            await _emit_alert(
                title="🚨 最近備份已過期",
                body=(
                    f"最新檔：{latest.name}\n"
                    f"已經過 {age_hours:.1f} 小時（門檻 {_BACKUP_STALE_HOURS}h）\n"
                    "請檢查 celery-worker-util 與 pg_dump 是否正常。"
                ),
            )
            await _set_flag("backup_stale", True)
    else:
        if fired:
            await _emit_alert(
                title="✅ 備份已恢復新鮮",
                body=f"最新檔：{latest.name}（{age_hours:.1f} 小時前）",
            )
            await _set_flag("backup_stale", False)
    return {"ok": True, "latest": latest.name, "age_hours": round(age_hours, 2)}


async def _check_outbox_dead() -> dict[str, Any]:
    """outbox dead letter 累積過多 → 告警。"""
    from sqlalchemy import func, select

    from api.models.outbox import OutboxEvent, OutboxStatus

    try:
        async with _task_session() as session:
            count = int(
                (
                    await session.execute(
                        select(func.count()).where(OutboxEvent.status == OutboxStatus.DEAD)
                    )
                ).scalar_one()
            )
    except Exception:
        logger.exception("outbox dead count failed")
        return {"ok": False}

    fired = await _flag_state("outbox_dead")
    if count >= _OUTBOX_DEAD_WARN:
        if not fired:
            await _emit_alert(
                title=f"⚠️ Outbox dead letter 累積 {count} 筆",
                body=(
                    f"超過門檻 {_OUTBOX_DEAD_WARN}\n"
                    "代表通知（Email / LINE / Discord）連續送達失敗。\n"
                    "請進 /admin/reports → 「Outbox 失敗事件（dead）」報表查看細節。"
                ),
            )
            await _set_flag("outbox_dead", True)
    else:
        if fired:
            await _emit_alert(
                title="✅ Outbox dead letter 已下降",
                body=f"目前 {count} 筆（門檻 {_OUTBOX_DEAD_WARN}）",
            )
            await _set_flag("outbox_dead", False)
    return {"ok": True, "count": count}
