"""HTTP rate limit middleware（Redis-backed，含 per-endpoint 配額）。"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable

from redis.exceptions import RedisError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from api.core.defense import get_rate_limit_config
from api.core.security import redis_client
from api.core.trust import request_is_trusted

logger = logging.getLogger(__name__)

# 內存降級 rate limit（Redis 不可用時的最後防線）。
# 警告：此計數器為 per-process，多 worker 部署時每個 worker 各自計數，
# 等效上限為 N × requests；攻擊者可輪詢不同 worker 繞過。Redis 恢復後立即失效。
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

    def _check_memory_rate_limit(self, key: str, req_limit: int, win: int) -> bool:
        """簡單的內存降級 rate limit（固定視窗）"""
        now = time.time()
        window_start = now - win

        # 清理舊記錄
        _memory_buckets[key] = [t for t in _memory_buckets[key] if t > window_start]
        _memory_buckets[key].append(now)

        return len(_memory_buckets[key]) > req_limit

    async def __call__(self, scope, receive, send) -> None:
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
        enabled, req_limit, win = await self._policy_for_path(request.url.path)
        if not enabled:
            await self.app(scope, receive, send)
            return
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
                "Rate limit Redis 不可用，降級至 per-process 內存限流"
                "（多 worker 環境下有效上限為 N×%d，請立即修復 Redis）",
                req_limit,
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
        except Exception:
            logger.error(
                "Rate limit 意外失敗，降級至 per-process 內存限流",
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
