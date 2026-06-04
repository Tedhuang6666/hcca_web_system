"""伺服器端錯誤的記憶體 ring buffer — 供 admin/system 錯誤面板查詢。

沿用 query_audit 的模式：依簽章聚合、只保留最近 N 筆、不落磁碟（避免敏感資訊外洩），
重啟後清空。錯誤會分類（db / redis / timeout / http / unhandled）以驅動前端顏色與
建議的復原動作。
"""

from __future__ import annotations

import json
import threading
import time
import traceback
from collections import deque
from dataclasses import dataclass
from typing import Any

from api.core.config import settings

_RING_MAX = 100
_MESSAGE_MAX = 300
_TRACEBACK_MAX = 1600

# 分類關鍵字 → 類別。順序有意義：先比對較具體的 db / redis。
_DB_KEYWORDS = (
    "operationalerror",
    "dbapierror",
    "interfaceerror",
    "integrityerror",
    "programmingerror",
    "asyncpg",
    "psycopg",
    "sqlalchemy",
    "undefinedtable",
    "undefinedcolumn",
    "deadlock",
    "could not connect",
    "connection refused",
    "pool timeout",
)
_REDIS_KEYWORDS = ("redis", "rediserror")
_TIMEOUT_KEYWORDS = ("timeouterror", "timed out", "asyncio.timeout")


def classify(exc_type: str, message: str) -> str:
    """依例外型別名稱與訊息推斷類別，供前端上色與建議復原動作。"""
    blob = f"{exc_type} {message}".lower()
    if any(k in blob for k in _DB_KEYWORDS):
        return "db"
    if any(k in blob for k in _REDIS_KEYWORDS):
        return "redis"
    if any(k in blob for k in _TIMEOUT_KEYWORDS):
        return "timeout"
    return "unhandled"


@dataclass
class ErrorSample:
    signature: str
    error_id: str
    category: str
    exc_type: str
    message: str
    method: str
    path: str
    status_code: int
    traceback_head: str
    first_seen: float
    last_seen: float
    occurrences: int = 1
    request_id: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None

    def touch(self, error_id: str, message: str, status_code: int) -> None:
        self.occurrences += 1
        self.last_seen = time.time()
        self.error_id = error_id
        self.message = message
        self.status_code = status_code


_samples: deque[ErrorSample] = deque(maxlen=_RING_MAX)
_index: dict[str, ErrorSample] = {}
_lock = threading.Lock()


def _format_traceback(exc: BaseException) -> str:
    if exc.__traceback__ is None:
        return ""
    text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    if len(text) > _TRACEBACK_MAX:
        # 保留尾端（最接近錯誤點的 frame 通常最有用）
        return "...(截斷)\n" + text[-_TRACEBACK_MAX:]
    return text


def _sample_to_dict(sample: ErrorSample, *, source: str = "memory") -> dict[str, object]:
    return {
        "error_id": sample.error_id,
        "request_id": sample.request_id,
        "client_ip": sample.client_ip,
        "user_agent": sample.user_agent,
        "category": sample.category,
        "exc_type": sample.exc_type,
        "message": sample.message,
        "method": sample.method,
        "path": sample.path,
        "status_code": sample.status_code,
        "traceback_head": sample.traceback_head,
        "first_seen": sample.first_seen,
        "last_seen": sample.last_seen,
        "occurrences": sample.occurrences,
        "source": source,
    }


def _persist_error_event(sample: ErrorSample) -> None:
    """Write a sanitized error event to Redis for cross-process reporting."""
    if not settings.ERROR_REPORT_EMAIL_ENABLED:
        return
    try:
        from redis import Redis

        payload: dict[str, Any] = {
            "occurred_at": sample.last_seen,
            "error_id": sample.error_id,
            "request_id": sample.request_id,
            "category": sample.category,
            "exc_type": sample.exc_type,
            "message": sample.message,
            "method": sample.method,
            "path": sample.path,
            "status_code": sample.status_code,
            "client_ip": sample.client_ip,
            "user_agent": sample.user_agent,
            "traceback_head": sample.traceback_head,
        }
        client = Redis.from_url(
            str(settings.REDIS_URL),
            decode_responses=True,
            socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
            socket_connect_timeout=settings.REDIS_SOCKET_TIMEOUT,
        )
        pipe = client.pipeline()
        pipe.lpush(settings.ERROR_REPORT_REDIS_KEY, json.dumps(payload, ensure_ascii=False))
        pipe.ltrim(settings.ERROR_REPORT_REDIS_KEY, 0, settings.ERROR_REPORT_RETENTION_ITEMS - 1)
        pipe.execute()
        client.close()
    except Exception:
        # Error reporting must never affect the original error response.
        pass


def record_error(
    *,
    error_id: str,
    exc: BaseException,
    method: str,
    path: str,
    status_code: int,
    category: str | None = None,
    request_id: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """記錄一筆 5xx / 未處理例外。相同簽章（類別+型別+方法+路徑）只聚合計數。"""
    exc_type = type(exc).__name__
    message = str(exc)[:_MESSAGE_MAX]
    cat = category or classify(exc_type, message)
    signature = f"{cat}:{exc_type}:{method}:{path}"
    with _lock:
        existing = _index.get(signature)
        if existing is not None:
            existing.touch(error_id, message, status_code)
            existing.request_id = request_id
            existing.client_ip = client_ip
            existing.user_agent = user_agent
            _persist_error_event(existing)
            return
        sample = ErrorSample(
            signature=signature,
            error_id=error_id,
            category=cat,
            exc_type=exc_type,
            message=message,
            method=method,
            path=path,
            status_code=status_code,
            traceback_head=_format_traceback(exc),
            first_seen=time.time(),
            last_seen=time.time(),
            request_id=request_id,
            client_ip=client_ip,
            user_agent=user_agent,
        )
        _samples.append(sample)
        _index[signature] = sample
        _persist_error_event(sample)
        # deque 上限會自動擠出舊元素，但 index 不會跟著縮，這裡用存活集合校正
        if len(_index) > _RING_MAX:
            alive = {s.signature for s in _samples}
            for key in list(_index.keys()):
                if key not in alive:
                    _index.pop(key, None)


def get_recent_errors(top: int = 50) -> list[dict[str, object]]:
    """取最近發生（last_seen 由新到舊）的錯誤樣本。"""
    with _lock:
        snapshot = list(_samples)
    snapshot.sort(key=lambda s: s.last_seen, reverse=True)
    return [_sample_to_dict(s) for s in snapshot[: max(1, min(top, _RING_MAX))]]


async def find_error_by_id(error_id: str) -> dict[str, object] | None:
    """Find a server error by public error_id from memory first, then Redis."""
    needle = error_id.strip()
    if not needle:
        return None
    with _lock:
        for sample in _samples:
            if sample.error_id == needle:
                return _sample_to_dict(sample)

    try:
        from api.core.security import redis_client

        raw_items = await redis_client.lrange(settings.ERROR_REPORT_REDIS_KEY, 0, -1)
    except Exception:
        return None

    for raw in raw_items:
        try:
            item = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict) or item.get("error_id") != needle:
            continue
        occurred_at = float(item.get("occurred_at") or 0)
        return {
            "error_id": str(item.get("error_id") or ""),
            "request_id": item.get("request_id"),
            "client_ip": item.get("client_ip"),
            "user_agent": item.get("user_agent"),
            "category": str(item.get("category") or "unhandled"),
            "exc_type": str(item.get("exc_type") or ""),
            "message": str(item.get("message") or ""),
            "method": str(item.get("method") or ""),
            "path": str(item.get("path") or ""),
            "status_code": int(item.get("status_code") or 500),
            "traceback_head": str(item.get("traceback_head") or ""),
            "first_seen": occurred_at,
            "last_seen": occurred_at,
            "occurrences": 1,
            "source": "redis",
        }
    return None


def clear_errors() -> int:
    """清空 ring buffer，回傳清掉的樣本數。"""
    with _lock:
        count = len(_samples)
        _samples.clear()
        _index.clear()
    return count
