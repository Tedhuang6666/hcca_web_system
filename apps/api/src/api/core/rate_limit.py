"""HTTP rate limit middleware（Redis-backed，含 per-endpoint 配額）。"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable

from redis.exceptions import RedisError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from api.core.security import redis_client

logger = logging.getLogger(__name__)

# 簡單的內存降級 rate limit（當 Redis 不可用時使用）
_memory_buckets: dict[str, list[float]] = defaultdict(list)


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
            ("/auth/refresh", 30, 60),
            ("/auth/google/login", 30, 60),
            ("/auth/google/callback", 30, 60),
            ("/notifications/email", 10, 60),
        ]

    def _policy_for_path(self, path: str) -> tuple[int, int]:
        for prefix, req, win in self._overrides:
            if path.startswith(prefix):
                return req, win
        return self.requests, self.window_seconds

    def _check_memory_rate_limit(self, key: str, req_limit: int, win: int) -> bool:
        """簡單的內存降級 rate limit（固定視窗）"""
        now = time.time()
        window_start = now - win

        # 清理舊記錄
        _memory_buckets[key] = [t for t in _memory_buckets[key] if t > window_start]
        _memory_buckets[key].append(now)

        return len(_memory_buckets[key]) > req_limit

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        if request.url.path == "/health":
            await self.app(scope, receive, send)
            return

        client_host = request.client.host if request.client else "unknown"
        req_limit, win = self._policy_for_path(request.url.path)
        now = int(time.time())
        bucket = now - (now % win)
        key = f"rate_limit:{client_host}:{request.method}:{request.url.path}:{bucket}"

        try:
            # INCR + EXPIRE：固定視窗計數
            pipe = redis_client.pipeline()
            pipe.incr(key)
            pipe.expire(key, win + 5)
            count, _ttl_set = await pipe.execute()
            if int(count) > req_limit:
                response = JSONResponse(
                    {"detail": "請求過於頻繁，請稍後再試"},
                    status_code=429,
                    headers={"Retry-After": str(win)},
                )
                await response(scope, receive, send)
                return
        except RedisError:
            logger.error(
                "Rate limit Redis connection failed, degrading to memory-based limit",
                exc_info=True,
                extra={"client_ip": client_host, "path": request.url.path},
            )
            # 降級到內存 rate limit
            if self._check_memory_rate_limit(key, req_limit, win):
                response = JSONResponse(
                    {"detail": "請求過於頻繁，請稍後再試"},
                    status_code=429,
                    headers={"Retry-After": str(win)},
                )
                await response(scope, receive, send)
                return
        except Exception:
            logger.warning(
                "Unexpected rate limit failure, degrading to memory-based limit",
                exc_info=True,
                extra={"client_ip": client_host, "path": request.url.path},
            )
            if self._check_memory_rate_limit(key, req_limit, win):
                response = JSONResponse(
                    {"detail": "請求過於頻繁，請稍後再試"},
                    status_code=429,
                    headers={"Retry-After": str(win)},
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)
