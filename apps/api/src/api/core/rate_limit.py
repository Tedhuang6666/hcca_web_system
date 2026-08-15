"""HTTP rate limit middleware（Redis-backed，含 per-endpoint 配額）。"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable

from redis.exceptions import RedisError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from api.core.defense import get_rate_limit_config
from api.core.prometheus_metrics import record_rate_limit_blocked
from api.core.security import redis_client
from api.core.trust import request_is_trusted

logger = logging.getLogger(__name__)

_REDIS_CHECK_TIMEOUT_SECONDS = 0.25
_REDIS_BACKOFF_POLICY_TIMEOUT_SECONDS = 0.01
_REDIS_BACKOFF_SECONDS = 5.0
_redis_backoff_until = 0.0


class _BoundedMemoryBuckets:
    """Redis 故障時使用的 bounded per-process 固定視窗計數器。"""

    def __init__(self, max_entries: int = 8_192) -> None:
        self.max_entries = max_entries
        self.buckets: OrderedDict[str, list[float]] = OrderedDict()

    def clear(self) -> None:
        self.buckets.clear()

    def check(self, key: str, req_limit: int, window_seconds: int) -> bool:
        now = time.monotonic()
        window_start = now - window_seconds

        # 每次寫入都掃描並清理過期項目，避免只有再次命中同一 key 才釋放記憶體。
        for bucket_key, timestamps in list(self.buckets.items()):
            fresh = [timestamp for timestamp in timestamps if timestamp > window_start]
            if fresh:
                self.buckets[bucket_key] = fresh
            else:
                del self.buckets[bucket_key]

        timestamps = self.buckets.pop(key, [])
        timestamps.append(now)
        self.buckets[key] = timestamps
        while len(self.buckets) > self.max_entries:
            self.buckets.popitem(last=False)

        return len(timestamps) > req_limit


# Redis 恢復後這些短期資料自然在下一次請求被覆蓋；每個 process 共用一個限流桶。
_MEMORY_CACHE_MAX_ENTRIES = 8_192
_memory_buckets = _BoundedMemoryBuckets(_MEMORY_CACHE_MAX_ENTRIES)


class SimpleRateLimitMiddleware:
    """
    以 Redis 做固定視窗限流（支援多 worker/多節點）。

    key：client IP + method + path + window bucket
    - 預設 requests / window_seconds
    - 針對高風險端點提供較低配額（per-endpoint overrides）
    """

    def __init__(
        self,
        app: Callable[[Request], Awaitable[Response]],
        *,
        enabled: bool,
        requests: int,
        window_seconds: int,
    ) -> None:
        self.app = app
        self.enabled = enabled
        self.requests = requests
        self.window_seconds = window_seconds

        self._overrides: list[tuple[str, int, int]] = [
            ("/auth/refresh", 20, 60),
            ("/auth/google/login", 20, 60),
            ("/auth/google/callback", 20, 60),
            ("/auth/google/one-tap", 5, 60),
            ("/auth/mfa", 10, 60),
            ("/admin/", 90, 60),
            ("/notifications/email", 10, 60),
            ("/email", 20, 60),
            ("/documents/attachments", 15, 60),
            ("/surveys", 40, 60),
            ("/petitions", 30, 60),
        ]

    async def _policy_for_path(self, path: str) -> tuple[bool, int, int]:
        config = await get_rate_limit_config()
        enabled = bool(config.get("enabled", self.enabled))
        req_limit = int(config.get("global_requests") or self.requests)
        win = int(config.get("global_window_seconds") or self.window_seconds)
        overrides = config.get("overrides")
        if isinstance(overrides, list):
            for item in overrides:
                if not isinstance(item, dict):
                    continue
                prefix = str(item.get("path_prefix") or "")
                if prefix and path.startswith(prefix):
                    return (
                        enabled,
                        int(item.get("requests") or req_limit),
                        int(item.get("window_seconds") or win),
                    )
        for prefix, req, win in self._overrides:
            if path.startswith(prefix):
                return enabled, req, win
        return enabled, req_limit, win

    @staticmethod
    def _route_template(path: str) -> str:
        """將高基數 URL 歸併成有限的路由模板，避免每個資源 ID 建立新 key。"""
        segments = [segment for segment in path.split("/") if segment]
        if not segments:
            return "/"
        if len(segments) == 1:
            return f"/{segments[0]}"
        return f"/{segments[0]}/{{route}}"

    def _check_memory_rate_limit(self, key: str, req_limit: int, win: int) -> bool:
        """簡單的內存降級 rate limit（固定視窗）"""
        return _memory_buckets.check(key, req_limit, win)

    async def __call__(self, scope, receive, send) -> None:
        global _redis_backoff_until

        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        if request.url.path in {"/health", "/live", "/ready"}:
            await self.app(scope, receive, send)
            return

        # 自己人白名單 IP / 有效掃描 token → 不限流
        if request_is_trusted(scope):
            await self.app(scope, receive, send)
            return

        client_host = request.client.host if request.client else "unknown"
        redis_usable = time.monotonic() >= _redis_backoff_until
        try:
            enabled, req_limit, win = await asyncio.wait_for(
                self._policy_for_path(request.url.path),
                timeout=(
                    _REDIS_CHECK_TIMEOUT_SECONDS
                    if redis_usable
                    else _REDIS_BACKOFF_POLICY_TIMEOUT_SECONDS
                ),
            )
        except (RedisError, TimeoutError):
            if redis_usable:
                # A slow policy read must not block every request. Keep the static
                # deployment defaults while Redis recovers; the memory counter is
                # used for the short backoff window below.
                _redis_backoff_until = time.monotonic() + _REDIS_BACKOFF_SECONDS
                redis_usable = False
            enabled, req_limit, win = self.enabled, self.requests, self.window_seconds
        if not enabled:
            await self.app(scope, receive, send)
            return
        now = int(time.time())
        bucket = now - (now % win)
        route_template = self._route_template(request.url.path)
        key = f"rate_limit:{client_host}:{request.method}:{route_template}:{bucket}"

        if not redis_usable:
            if self._check_memory_rate_limit(key, req_limit, win):
                record_rate_limit_blocked("memory")
                response = JSONResponse(
                    {"detail": "請求過於頻繁，請稍後再試"},
                    status_code=429,
                    headers={"Retry-After": str(win)},
                )
                await response(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        try:
            # INCR + EXPIRE：固定視窗計數
            pipe = redis_client.pipeline()
            pipe.incr(key)
            pipe.expire(key, win + 5)
            count, _ttl_set = await asyncio.wait_for(
                pipe.execute(),
                timeout=_REDIS_CHECK_TIMEOUT_SECONDS,
            )
            if int(count) > req_limit:
                record_rate_limit_blocked("redis")
                response = JSONResponse(
                    {"detail": "請求過於頻繁，請稍後再試"},
                    status_code=429,
                    headers={"Retry-After": str(win)},
                )
                await response(scope, receive, send)
                return
        except (RedisError, TimeoutError):
            _redis_backoff_until = time.monotonic() + _REDIS_BACKOFF_SECONDS
            logger.error(
                "Rate limit Redis 不可用，降級至 per-process 內存限流"
                "（多 worker 環境下有效上限為 N×%d，請立即修復 Redis）",
                req_limit,
                exc_info=True,
                extra={"client_ip": client_host, "path": request.url.path},
            )
            if self._check_memory_rate_limit(key, req_limit, win):
                record_rate_limit_blocked("memory")
                response = JSONResponse(
                    {"detail": "請求過於頻繁，請稍後再試"},
                    status_code=429,
                    headers={"Retry-After": str(win)},
                )
                await response(scope, receive, send)
                return
        except Exception:
            logger.error(
                "Rate limit 意外失敗，降級至 per-process 內存限流",
                exc_info=True,
                extra={"client_ip": client_host, "path": request.url.path},
            )
            if self._check_memory_rate_limit(key, req_limit, win):
                record_rate_limit_blocked("memory")
                response = JSONResponse(
                    {"detail": "請求過於頻繁，請稍後再試"},
                    status_code=429,
                    headers={"Retry-After": str(win)},
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)
