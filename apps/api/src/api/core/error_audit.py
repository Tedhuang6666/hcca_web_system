"""跨 worker 的錯誤稽核：structured log、本機 ring buffer 與 Redis 事件保留。"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
import traceback
import uuid
from collections import deque
from dataclasses import dataclass
from typing import Any

from api.core.config import settings

logger = logging.getLogger(__name__)

_RING_MAX = 100
_REDIS_EVENT_KEY = "error_audit:events:v1"
_REDIS_RETENTION_ITEMS = 1000
_MESSAGE_MAX = 1000
_TRACEBACK_MAX = 6000
_REDIS_WRITE_TIMEOUT_SECONDS = 0.25

_SENSITIVE_TEXT = re.compile(
    r"(?i)(bearer\s+)[^\s,;]+|((?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;]+"
)

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
    trace_id: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None

    def touch(
        self,
        error_id: str,
        message: str,
        status_code: int,
        traceback_head: str,
    ) -> None:
        self.occurrences += 1
        self.last_seen = time.time()
        self.error_id = error_id
        self.message = message
        self.status_code = status_code
        if traceback_head:
            self.traceback_head = traceback_head


_samples: deque[ErrorSample] = deque(maxlen=_RING_MAX)
_index: dict[str, ErrorSample] = {}
_lock = threading.Lock()


def _sanitize_text(value: str, limit: int) -> str:
    sanitized = _SENSITIVE_TEXT.sub(r"\1[Filtered]", value)
    if len(sanitized) > limit:
        return sanitized[:limit] + "...(截斷)"
    return sanitized


def _format_traceback(exc: BaseException) -> str:
    if exc.__traceback__ is None:
        return ""
    text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    # traceback 可能包含 request payload 或第三方 SDK 回傳內容，先遮蔽再留存。
    return _sanitize_text(text, _TRACEBACK_MAX)


def _sample_to_dict(sample: ErrorSample, *, source: str = "memory") -> dict[str, object]:
    return {
        "error_id": sample.error_id,
        "request_id": sample.request_id,
        "trace_id": sample.trace_id,
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


def _event_payload(sample: ErrorSample) -> dict[str, Any]:
    return {
        "signature": sample.signature,
        "occurred_at": sample.last_seen,
        "first_seen": sample.first_seen,
        "error_id": sample.error_id,
        "request_id": sample.request_id,
        "trace_id": sample.trace_id,
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


async def _persist_error_event(payload: dict[str, Any]) -> None:
    """Write a sanitized error event to Redis for cross-process audit lookup."""
    try:
        from api.core.security import redis_client

        async with asyncio.timeout(
            min(settings.REDIS_SOCKET_TIMEOUT, _REDIS_WRITE_TIMEOUT_SECONDS)
        ):
            await redis_client.lpush(_REDIS_EVENT_KEY, json.dumps(payload, ensure_ascii=False))
            await redis_client.ltrim(_REDIS_EVENT_KEY, 0, _REDIS_RETENTION_ITEMS - 1)
    except Exception:
        # Redis 只是跨 worker 的第二份儲存；stdout structured log 與本 process
        # ring buffer 仍會保留事件，不能讓記錄失敗反過來打壞原始回應。
        logger.warning("錯誤稽核寫入 Redis 失敗（已保留本機 log）", exc_info=True)


async def _record_event(
    *,
    error_id: str,
    exc_type: str,
    message: str,
    traceback_head: str,
    method: str,
    path: str,
    status_code: int,
    category: str,
    request_id: str | None,
    trace_id: str | None,
    client_ip: str | None,
    user_agent: str | None,
) -> str:
    safe_message = _sanitize_text(message, _MESSAGE_MAX)
    safe_traceback = _sanitize_text(traceback_head, _TRACEBACK_MAX)
    signature = f"{category}:{exc_type}:{method}:{path}"
    with _lock:
        existing = _index.get(signature)
        if existing is not None:
            existing.touch(error_id, safe_message, status_code, safe_traceback)
            existing.request_id = request_id
            existing.trace_id = trace_id
            existing.client_ip = client_ip
            existing.user_agent = user_agent
            sample = existing
        else:
            now = time.time()
            sample = ErrorSample(
                signature=signature,
                error_id=error_id,
                category=category,
                exc_type=exc_type,
                message=safe_message,
                method=method,
                path=path,
                status_code=status_code,
                traceback_head=safe_traceback,
                first_seen=now,
                last_seen=now,
                request_id=request_id,
                trace_id=trace_id,
                client_ip=client_ip,
                user_agent=user_agent,
            )
            _samples.append(sample)
            _index[signature] = sample
            # deque 上限會自動擠出舊元素，但 index 不會跟著縮，這裡用存活集合校正。
            if len(_index) > _RING_MAX:
                alive = {item.signature for item in _samples}
                for key in list(_index.keys()):
                    if key not in alive:
                        _index.pop(key, None)
        payload = _event_payload(sample)

    await _persist_error_event(payload)
    level = logging.ERROR if status_code >= 500 else logging.WARNING
    logger.log(
        level,
        "Error recorded id=%s category=%s type=%s method=%s path=%s status=%s occurrences=%s",
        error_id,
        category,
        exc_type,
        method,
        path,
        status_code,
        sample.occurrences,
        extra={
            "event": "error.recorded",
            "error_id": error_id,
            "error_category": category,
            "error_type": exc_type,
            "method": method,
            "path": path,
            "status_code": status_code,
            "occurrences": sample.occurrences,
        },
    )
    return error_id


async def record_error(
    *,
    error_id: str,
    exc: BaseException,
    method: str,
    path: str,
    status_code: int,
    category: str | None = None,
    request_id: str | None = None,
    trace_id: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> str:
    """記錄一筆錯誤；相同簽章（類別+型別+方法+路徑）只聚合計數。"""
    exc_type = type(exc).__name__
    message = str(exc)
    return await _record_event(
        error_id=error_id,
        exc_type=exc_type,
        message=message,
        traceback_head=_format_traceback(exc),
        method=method,
        path=path,
        status_code=status_code,
        category=category or classify(exc_type, message),
        request_id=request_id,
        trace_id=trace_id,
        client_ip=client_ip,
        user_agent=user_agent,
    )


async def record_client_error(
    *,
    message: str,
    stack: str,
    scope: str,
    path: str,
    request_id: str | None = None,
    trace_id: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> str:
    """記錄瀏覽器 runtime error，與伺服器例外共用同一個 audit pipeline。"""
    return await _record_event(
        error_id=uuid.uuid4().hex[:12],
        exc_type="ClientError",
        message=f"[{scope}] {message}",
        traceback_head=stack,
        method="CLIENT",
        path=path or "unknown",
        status_code=500,
        category="unhandled",
        request_id=request_id,
        trace_id=trace_id,
        client_ip=client_ip,
        user_agent=user_agent,
    )


def record_background_error(
    *,
    task: str,
    task_id: str | None,
    exc: BaseException,
    traceback_text: str = "",
    trace_id: str | None = None,
) -> str:
    """同步背景 worker 使用的錯誤入口（Celery signal 不在 API event loop）。"""
    error_id = uuid.uuid4().hex[:12]
    exc_type = type(exc).__name__
    message = str(exc)
    category = classify(exc_type, message)
    path = f"celery://{task}"
    safe_message = _sanitize_text(message, _MESSAGE_MAX)
    safe_traceback = _sanitize_text(traceback_text, _TRACEBACK_MAX)
    signature = f"{category}:{exc_type}:CELERY:{path}"
    with _lock:
        existing = _index.get(signature)
        if existing is not None:
            existing.touch(error_id, safe_message, 500, safe_traceback)
            existing.request_id = task_id
            existing.trace_id = trace_id
            sample = existing
        else:
            now = time.time()
            sample = ErrorSample(
                signature=signature,
                error_id=error_id,
                category=category,
                exc_type=exc_type,
                message=safe_message,
                method="CELERY",
                path=path,
                status_code=500,
                traceback_head=safe_traceback,
                first_seen=now,
                last_seen=now,
                request_id=task_id,
                trace_id=trace_id,
            )
            _samples.append(sample)
            _index[signature] = sample
            if len(_index) > _RING_MAX:
                alive = {item.signature for item in _samples}
                for key in list(_index.keys()):
                    if key not in alive:
                        _index.pop(key, None)
        payload = _event_payload(sample)

    try:
        from redis import Redis

        client = Redis.from_url(
            str(settings.REDIS_URL),
            decode_responses=True,
            socket_timeout=min(settings.REDIS_SOCKET_TIMEOUT, _REDIS_WRITE_TIMEOUT_SECONDS),
            socket_connect_timeout=min(settings.REDIS_SOCKET_TIMEOUT, _REDIS_WRITE_TIMEOUT_SECONDS),
        )
        pipe = client.pipeline()
        pipe.lpush(_REDIS_EVENT_KEY, json.dumps(payload, ensure_ascii=False))
        pipe.ltrim(_REDIS_EVENT_KEY, 0, _REDIS_RETENTION_ITEMS - 1)
        pipe.execute()
        client.close()
    except Exception:
        logger.warning("背景任務錯誤寫入 Redis 失敗（已保留 worker log）", exc_info=True)
    logger.error(
        "Background error recorded id=%s task=%s task_id=%s type=%s",
        error_id,
        task,
        task_id,
        exc_type,
        extra={
            "event": "error.recorded",
            "error_id": error_id,
            "error_category": category,
            "error_type": exc_type,
            "task": task,
            "task_id": task_id,
            "status_code": 500,
        },
    )
    return error_id


async def get_recent_errors(top: int = 50) -> list[dict[str, object]]:
    """取跨 worker 的最近錯誤；Redis 可用時以 Redis 事件聚合結果為準。"""
    limit = max(1, min(top, _RING_MAX))
    try:
        from api.core.security import redis_client

        async with asyncio.timeout(
            min(settings.REDIS_SOCKET_TIMEOUT, _REDIS_WRITE_TIMEOUT_SECONDS)
        ):
            raw_items = await redis_client.lrange(_REDIS_EVENT_KEY, 0, _REDIS_RETENTION_ITEMS - 1)
    except Exception:
        raw_items = []

    if raw_items:
        aggregated: dict[str, dict[str, object]] = {}
        for raw in raw_items:
            try:
                item = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if not isinstance(item, dict):
                continue
            signature = str(
                item.get("signature")
                or f"{item.get('category', 'unhandled')}:{item.get('exc_type', '')}:"
                f"{item.get('method', '')}:{item.get('path', '')}"
            )
            occurred_at = float(item.get("occurred_at") or 0)
            current = aggregated.get(signature)
            if current is None:
                current = {
                    "error_id": str(item.get("error_id") or ""),
                    "request_id": item.get("request_id"),
                    "trace_id": item.get("trace_id"),
                    "client_ip": item.get("client_ip"),
                    "user_agent": item.get("user_agent"),
                    "category": str(item.get("category") or "unhandled"),
                    "exc_type": str(item.get("exc_type") or ""),
                    "message": str(item.get("message") or ""),
                    "method": str(item.get("method") or ""),
                    "path": str(item.get("path") or ""),
                    "status_code": int(item.get("status_code") or 500),
                    "traceback_head": str(item.get("traceback_head") or ""),
                    "first_seen": float(item.get("first_seen") or occurred_at),
                    "last_seen": occurred_at,
                    "occurrences": 1,
                    "source": "redis",
                }
                aggregated[signature] = current
            else:
                current["occurrences"] = int(current["occurrences"]) + 1
                if occurred_at >= float(current["last_seen"]):
                    current.update(
                        {
                            "error_id": str(item.get("error_id") or current["error_id"]),
                            "request_id": item.get("request_id"),
                            "trace_id": item.get("trace_id"),
                            "client_ip": item.get("client_ip"),
                            "user_agent": item.get("user_agent"),
                            "message": str(item.get("message") or current["message"]),
                            "status_code": int(item.get("status_code") or current["status_code"]),
                            "traceback_head": str(
                                item.get("traceback_head") or current["traceback_head"]
                            ),
                            "last_seen": occurred_at,
                        }
                    )
        result = list(aggregated.values())
        result.sort(key=lambda item: float(item["last_seen"]), reverse=True)
        return result[:limit]

    with _lock:
        snapshot = list(_samples)
    snapshot.sort(key=lambda s: s.last_seen, reverse=True)
    return [_sample_to_dict(s) for s in snapshot[:limit]]


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

        async with asyncio.timeout(
            min(settings.REDIS_SOCKET_TIMEOUT, _REDIS_WRITE_TIMEOUT_SECONDS)
        ):
            raw_items = await redis_client.lrange(_REDIS_EVENT_KEY, 0, -1)
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
            "trace_id": item.get("trace_id"),
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


async def clear_errors() -> int:
    """清空本機與跨 worker 的錯誤緩衝，回傳清掉的本機樣本數。"""
    with _lock:
        count = len(_samples)
        _samples.clear()
        _index.clear()
    try:
        from api.core.security import redis_client

        async with asyncio.timeout(
            min(settings.REDIS_SOCKET_TIMEOUT, _REDIS_WRITE_TIMEOUT_SECONDS)
        ):
            await redis_client.delete(_REDIS_EVENT_KEY)
    except Exception:
        logger.warning("清空 Redis 錯誤稽核緩衝失敗", exc_info=True)
    return count
