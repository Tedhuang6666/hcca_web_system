"""資料庫備份 Celery task — 每日 pg_dump、輪轉 N 天、可選同步上傳 S3。"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import stat
import subprocess
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from celery.exceptions import MaxRetriesExceededError

from api.core.celery_app import celery_app
from api.core.config import settings
from api.core.prometheus_metrics import record_backup_run

logger = logging.getLogger(__name__)


def _emit_backup_alert_sync(title: str, body: str) -> None:
    """同步 helper：把備份事件寫入 outbox，由 discord worker 推 Discord 告警頻道。

    在 Celery worker 內呼叫；無 event loop 環境用 asyncio.run 包起來。
    失敗不重拋（告警本身不該拖垮備份任務）。
    """
    if not settings.MODULE_ALERT_DISCORD_CHANNEL_ID:
        return

    async def _go() -> None:
        from api.core.database import task_session
        from api.services import outbox

        async with task_session() as session:
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
    for pattern in (
        "hcca_backup_*.dump",
        "hcca_backup_*.dump.gpg",
        "hcca_backup_*.sql.gz",
        "hcca_backup_*.sql.gz.gpg",
    ):
        for f in backup_dir.glob(pattern):
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
        record_backup_run("database", "skipped")
        return {"status": "skipped", "reason": "DB_BACKUP_ENABLED=false"}

    backup_dir = Path(settings.DB_BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)

    user, password, host, port, db = _parse_database_url()
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    target = backup_dir / f"hcca_backup_{db}_{stamp}.dump"

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

    # 用 .pgpass 暫存檔傳遞密碼，避免密碼暴露在程序環境變數（/proc/<pid>/environ）。
    pgpass_fd, pgpass_path = tempfile.mkstemp(suffix=".pgpass")
    try:
        with os.fdopen(pgpass_fd, "w") as pf:
            pf.write(f"{host}:{port}:{db}:{user}:{password}\n")
        os.chmod(pgpass_path, stat.S_IRUSR | stat.S_IWUSR)  # 600，pgpass 規範要求
        run_env = {"PGPASSFILE": pgpass_path}
    except OSError:
        with contextlib.suppress(OSError):
            os.unlink(pgpass_path)
        raise

    try:
        with target.open("wb") as out:
            proc = subprocess.run(  # noqa: F841
                cmd,
                env=run_env,
                stdout=out,
                stderr=subprocess.PIPE,
                check=True,
                timeout=600,
            )
        logger.info("DB backup complete size=%d", target.stat().st_size)
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
        logger.error("pg_dump 失敗 exit_code=%s", e.returncode)
        target.unlink(missing_ok=True)
        try:
            raise self.retry(exc=e) from e
        except MaxRetriesExceededError:
            _emit_backup_alert_sync(
                title="🚨 資料庫備份失敗（已達重試上限）",
                body=f"原因：pg_dump 執行失敗（exit code {e.returncode}）。請查看受限 worker 記錄。",
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
    finally:
        with contextlib.suppress(OSError):
            os.unlink(pgpass_path)

    # 可選用 GPG 加密，並寫入 sha256 與 BackupRecord。
    final_path = target
    encrypted = False
    sha256_hex: str | None = None
    try:
        from api.services import backup_encryption

        if backup_encryption.is_encryption_configured():
            if backup_encryption.gpg_available():
                final_path = backup_encryption.encrypt_file(target, cleanup_src=True)
                encrypted = True
            else:
                logger.warning(
                    "BACKUP_GPG_PASSPHRASE set but gpg binary missing; backup left unencrypted"
                )

        if settings.BACKUP_VERIFY_SHA256:
            sha256_hex = backup_encryption.compute_sha256(final_path)
    except Exception:
        logger.exception("backup encryption/hash step failed; continuing with raw file")

    _write_backup_record_sync(
        kind="db",
        source_label=db,
        local_path=str(final_path),
        size_bytes=final_path.stat().st_size if final_path.exists() else None,
        sha256_hex=sha256_hex,
        encrypted=encrypted,
    )

    removed = _rotate_old_backups(backup_dir, settings.DB_BACKUP_RETENTION_DAYS)
    record_backup_run("database", "success")
    _ = proc  # silence linter
    return {
        "status": "ok",
        "file": str(final_path),
        "size": final_path.stat().st_size if final_path.exists() else None,
        "encrypted": encrypted,
        "sha256": sha256_hex,
        "removed_old": removed,
    }


def _write_backup_record_sync(
    *,
    kind: str,
    source_label: str,
    local_path: str,
    size_bytes: int | None,
    sha256_hex: str | None,
    encrypted: bool,
) -> None:
    """寫入 BackupRecord 紀錄；失敗不阻斷主任務。"""

    async def _go() -> None:
        from api.core.database import task_session
        from api.models.backup_record import BackupRecord, BackupStatus

        async with task_session() as session:
            try:
                now = datetime.now(UTC)
                row = BackupRecord(
                    kind=kind,
                    status=BackupStatus.SUCCEEDED.value,
                    source_label=source_label,
                    local_path=local_path,
                    size_bytes=size_bytes,
                    sha256_hex=sha256_hex,
                    encrypted=encrypted,
                    started_at=now,
                    completed_at=now,
                )
                session.add(row)
                await session.commit()
            except Exception:
                logger.exception("write BackupRecord failed")
                await session.rollback()

    try:
        asyncio.run(_go())
    except Exception:
        logger.exception("backup record async wrapper failed")


def _rotate_old_backups_all_exts(backup_dir: Path, retention_days: int) -> int:
    """Wrapper：清舊 custom dump 與歷史 .sql.gz 檔名。"""
    cutoff = time.time() - retention_days * 86400
    removed = 0
    for pattern in (
        "hcca_backup_*.dump",
        "hcca_backup_*.dump.gpg",
        "hcca_backup_*.sql.gz",
        "hcca_backup_*.sql.gz.gpg",
    ):
        for f in backup_dir.glob(pattern):
            if f.stat().st_mtime < cutoff:
                try:
                    f.unlink()
                    removed += 1
                except OSError:
                    logger.warning("無法刪除過期備份 %s", f, exc_info=True)
    return removed
