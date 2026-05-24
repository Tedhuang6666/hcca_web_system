"""即時系統指標採集器 — 給 admin 系統狀態頁與 load_shed middleware 共用。"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncEngine

from api.core.security import redis_client

logger = logging.getLogger(__name__)


@dataclass
class DbPoolSnapshot:
    size: int
    checked_in: int
    checked_out: int
    overflow: int

    @property
    def utilization(self) -> float:
        """0.0–1.0；考量 overflow 後的飽和度。"""
        capacity = self.size + max(self.overflow, 0)
        if capacity <= 0:
            return 0.0
        return min(1.0, self.checked_out / capacity)


def get_db_pool_stats(engine: AsyncEngine) -> DbPoolSnapshot:
    """讀取 SQLAlchemy async engine 的同步 pool 狀態（無 I/O）。"""
    pool = engine.sync_engine.pool
    return DbPoolSnapshot(
        size=int(getattr(pool, "size", lambda: 0)()),
        checked_in=int(getattr(pool, "checkedin", lambda: 0)()),
        checked_out=int(getattr(pool, "checkedout", lambda: 0)()),
        overflow=int(getattr(pool, "overflow", lambda: 0)()),
    )


async def get_redis_stats() -> dict[str, Any]:
    """從 Redis INFO clients 抓連線數；失敗回傳 error 欄位。"""
    try:
        info = await redis_client.info("clients")
        return {
            "connected_clients": int(info.get("connected_clients", 0)),
            "blocked_clients": int(info.get("blocked_clients", 0)),
            "error": None,
        }
    except RedisError as exc:
        return {"connected_clients": 0, "blocked_clients": 0, "error": exc.__class__.__name__}


async def get_celery_stats(timeout_seconds: float = 1.0) -> dict[str, Any]:
    """
    取 Celery 各 queue 的 active/reserved 任務數。
    `inspect()` 為阻塞呼叫，包進 to_thread 避免卡 event loop；
    任何 broker 異常都返回 error 欄位，呼叫端不要拋例外。
    """
    try:
        from api.core.celery_app import celery_app
    except Exception as exc:  # pragma: no cover — Celery 未配置時容錯
        return {"queues": [], "error": exc.__class__.__name__}

    def _inspect() -> dict[str, dict[str, list]] | None:
        try:
            insp = celery_app.control.inspect(timeout=timeout_seconds)
            return {
                "active": insp.active() or {},
                "reserved": insp.reserved() or {},
            }
        except Exception:  # broker down or no workers
            return None

    snapshot = await asyncio.to_thread(_inspect)
    if snapshot is None:
        return {"queues": [], "error": "inspect_failed"}

    queues: dict[str, dict[str, int]] = {}
    for worker, tasks in snapshot["active"].items():
        queues.setdefault(worker, {"active": 0, "reserved": 0})
        queues[worker]["active"] = len(tasks)
    for worker, tasks in snapshot["reserved"].items():
        queues.setdefault(worker, {"active": 0, "reserved": 0})
        queues[worker]["reserved"] = len(tasks)

    return {
        "queues": [{"name": w, **counts} for w, counts in queues.items()],
        "error": None,
    }
