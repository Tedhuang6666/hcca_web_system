"""維運復原工具 — 清快取 / 升級資料庫 / 重啟，供 admin/system 復原面板使用。

這些動作具破壞性，端點層已限定超級管理員並寫稽核 + 安全告警。
"""

from __future__ import annotations

import logging
import os
import signal
from pathlib import Path
from typing import Any

from api.core.config import settings

logger = logging.getLogger(__name__)

# 只清「應用層」快取前綴，刻意不碰限流計數、登入黑名單、JWT 撤銷、維護旗標，
# 以免清快取連帶把所有人登出或重置防護狀態。
_APP_CACHE_PREFIXES = ("org:tree:*", "perm:*", "doc:list:*")

_API_ROOT = Path(__file__).resolve().parents[3]
_SRC_API_DIR = Path(__file__).resolve().parents[1]
_RELOAD_SENTINEL = _SRC_API_DIR / "_reload_sentinel.py"


async def clear_app_cache() -> dict[str, Any]:
    """清除已知的應用層快取鍵；回傳清掉的鍵數與涵蓋的前綴。"""
    from api.core.security import redis_client

    total = 0
    for pattern in _APP_CACHE_PREFIXES:
        cursor = 0
        keys: list[Any] = []
        while True:
            cursor, batch = await redis_client.scan(cursor, match=pattern, count=200)
            keys.extend(batch)
            if cursor == 0:
                break
        if keys:
            total += await redis_client.delete(*keys)
    logger.info("clear_app_cache removed=%d patterns=%s", total, _APP_CACHE_PREFIXES)
    return {"cleared": total, "patterns": list(_APP_CACHE_PREFIXES)}


def _db_upgrade_sync() -> dict[str, Any]:
    """同步執行 alembic upgrade head（透過 Alembic Python API）。

    供 asyncio.to_thread 呼叫，避免阻塞 event loop。env.py 會用 DATABASE_URL_SYNC
    自建同步引擎，與應用的 async 引擎互不干擾。
    """
    from alembic import command
    from alembic.config import Config
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine, pool

    # 不傳 alembic.ini 路徑：避免 env.py 的 fileConfig() 重置正在運行的應用 logging。
    cfg = Config()
    cfg.set_main_option("script_location", str(_API_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL_SYNC)

    head_revision = ScriptDirectory.from_config(cfg).get_current_head()

    engine = create_engine(settings.DATABASE_URL_SYNC, poolclass=pool.NullPool)
    try:
        with engine.connect() as conn:
            before = MigrationContext.configure(conn).get_current_revision()
    finally:
        engine.dispose()

    command.upgrade(cfg, "head")

    return {
        "before_revision": before,
        "head_revision": head_revision,
        "changed": before != head_revision,
    }


async def run_db_upgrade() -> dict[str, Any]:
    """非阻塞執行資料庫遷移到最新版本。"""
    import asyncio

    result = await asyncio.to_thread(_db_upgrade_sync)
    logger.info(
        "run_db_upgrade before=%s head=%s changed=%s",
        result["before_revision"],
        result["head_revision"],
        result["changed"],
    )
    return result


def _touch_reload_sentinel() -> None:
    """更新 reload sentinel 的 mtime，觸發 uvicorn --reload 重載（dev）。

    只 bump mtime（os.utime），不改檔案內容，避免每次重啟都產生 git 變更。
    """
    if not _RELOAD_SENTINEL.exists():
        _RELOAD_SENTINEL.write_text(
            "# auto-reload trigger; mtime bump only\nLAST_RESTART = 0\n", encoding="utf-8"
        )
    os.utime(_RELOAD_SENTINEL, None)


def perform_restart() -> dict[str, Any]:
    """依環境觸發重啟：dev 觸發熱重載；prod 對 gunicorn master 送 SIGHUP 優雅重載。

    應在 HTTP 回應送出後（BackgroundTask）呼叫，讓管理員先收到確認。
    """
    env = settings.ENVIRONMENT
    if env == "development":
        _touch_reload_sentinel()
        logger.warning("perform_restart via reload sentinel (env=%s)", env)
        return {"method": "reload_sentinel", "environment": env}

    ppid = os.getppid()
    os.kill(ppid, signal.SIGHUP)
    logger.warning("perform_restart via SIGHUP to gunicorn master ppid=%d (env=%s)", ppid, env)
    return {"method": "sighup_master", "environment": env, "ppid": ppid}
