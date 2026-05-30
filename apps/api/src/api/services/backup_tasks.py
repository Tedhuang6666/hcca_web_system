"""資料庫備份 Celery task — 每日 pg_dump、輪轉 N 天、可選同步上傳 S3。"""

from __future__ import annotations

import asyncio
import logging
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from celery.exceptions import MaxRetriesExceededError

from api.core.celery_app import celery_app
from api.core.config import settings

logger = logging.getLogger(__name__)


def _emit_backup_alert_sync(title: str, body: str) -> None:
    """同步 helper：把備份事件寫入 outbox，由 discord worker 推 Discord 告警頻道。

    在 Celery worker 內呼叫；無 event loop 環境用 asyncio.run 包起來。
    失敗不重拋（告警本身不該拖垮備份任務）。
    """
    if not settings.MODULE_ALERT_DISCORD_CHANNEL_ID:
        return

    async def _go() -> None:
        from api.core.database import AsyncSessionLocal
        from api.services import outbox

        async with AsyncSessionLocal() as session:
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
                logger.exception("emit backup alert failed")
                await session.rollback()

    try:
        asyncio.run(_go())
    except Exception:
        logger.exception("backup alert sync wrapper failed")


def _parse_database_url() -> tuple[str, str, str, int, str]:
    """從 SQLAlchemy URL 抽出 pg_dump 所需參數 (user, password, host, port, db)。"""
    raw = str(settings.DATABASE_URL)
    parsed = urlparse(raw.replace("postgresql+asyncpg://", "postgresql://"))
    return (
        parsed.username or "postgres",
        parsed.password or "",
        parsed.hostname or "localhost",
        parsed.port or 5432,
        (parsed.path or "/postgres").lstrip("/"),
    )


def _rotate_old_backups(backup_dir: Path, retention_days: int) -> int:
    """刪除 retention_days 前的備份；回傳刪除數量。"""
    cutoff = time.time() - retention_days * 86400
    removed = 0
    for f in backup_dir.glob("hcca_backup_*.sql.gz"):
        if f.stat().st_mtime < cutoff:
            try:
                f.unlink()
                removed += 1
            except OSError:
                logger.warning("無法刪除過期備份 %s", f, exc_info=True)
    return removed


@celery_app.task(
    name="api.services.backup_tasks.backup_database",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def backup_database(self) -> dict:  # type: ignore[type-arg]
    """每日 pg_dump → gz 壓縮 → 輪轉舊檔；停用時直接回傳 skipped。"""
    if not settings.DB_BACKUP_ENABLED:
        return {"status": "skipped", "reason": "DB_BACKUP_ENABLED=false"}

    backup_dir = Path(settings.DB_BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)

    user, password, host, port, db = _parse_database_url()
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    target = backup_dir / f"hcca_backup_{db}_{stamp}.sql.gz"

    env = {"PGPASSWORD": password}
    cmd = [
        "pg_dump",
        "-h",
        host,
        "-p",
        str(port),
        "-U",
        user,
        "-d",
        db,
        "--no-owner",
        "--clean",
        "--if-exists",
        "-Fc",
    ]

    try:
        with target.open("wb") as out:
            proc = subprocess.run(  # noqa: S603
                cmd,
                env=env,
                stdout=out,
                stderr=subprocess.PIPE,
                check=True,
                timeout=600,
            )
        logger.info("DB backup complete file=%s size=%d", target, target.stat().st_size)
    except FileNotFoundError as e:
        logger.error("pg_dump 未安裝；請於 worker 環境安裝 postgresql-client", exc_info=True)
        try:
            raise self.retry(exc=e, countdown=600) from e
        except MaxRetriesExceededError:
            _emit_backup_alert_sync(
                title="🚨 資料庫備份失敗（已達重試上限）",
                body="原因：pg_dump 未安裝。請於 worker container 安裝 postgresql-client 後重啟。",
            )
            raise
    except subprocess.CalledProcessError as e:
        stderr_text = e.stderr.decode(errors="ignore") if e.stderr else ""
        logger.error("pg_dump 失敗 stderr=%s", stderr_text)
        target.unlink(missing_ok=True)
        try:
            raise self.retry(exc=e) from e
        except MaxRetriesExceededError:
            _emit_backup_alert_sync(
                title="🚨 資料庫備份失敗（已達重試上限）",
                body=f"原因：pg_dump 執行失敗\nstderr 摘錄：{stderr_text[:400]}",
            )
            raise
    except subprocess.TimeoutExpired as e:
        logger.error("pg_dump 逾時 (>600s)")
        target.unlink(missing_ok=True)
        try:
            raise self.retry(exc=e) from e
        except MaxRetriesExceededError:
            _emit_backup_alert_sync(
                title="🚨 資料庫備份失敗（已達重試上限）",
                body="原因：pg_dump 連續逾時（>600s）。資料庫可能負載過高或磁碟極慢。",
            )
            raise

    removed = _rotate_old_backups(backup_dir, settings.DB_BACKUP_RETENTION_DAYS)
    _ = proc  # silence linter
    return {
        "status": "ok",
        "file": str(target),
        "size": target.stat().st_size,
        "removed_old": removed,
    }
