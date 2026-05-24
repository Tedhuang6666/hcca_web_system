"""資料庫備份 Celery task — 每日 pg_dump、輪轉 N 天、可選同步上傳 S3。"""

from __future__ import annotations

import logging
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from api.core.celery_app import celery_app
from api.core.config import settings

logger = logging.getLogger(__name__)


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
        raise self.retry(exc=e, countdown=600) from e
    except subprocess.CalledProcessError as e:
        logger.error("pg_dump 失敗 stderr=%s", e.stderr.decode(errors="ignore") if e.stderr else "")
        target.unlink(missing_ok=True)
        raise self.retry(exc=e) from e
    except subprocess.TimeoutExpired as e:
        logger.error("pg_dump 逾時 (>600s)")
        target.unlink(missing_ok=True)
        raise self.retry(exc=e) from e

    removed = _rotate_old_backups(backup_dir, settings.DB_BACKUP_RETENTION_DAYS)
    _ = proc  # silence linter
    return {
        "status": "ok",
        "file": str(target),
        "size": target.stat().st_size,
        "removed_old": removed,
    }
