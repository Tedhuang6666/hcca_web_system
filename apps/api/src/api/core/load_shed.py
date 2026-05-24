"""Load Shedding Middleware — 高負載時讓非 admin 請求 503，保證 admin 通道暢通。

判定流程：
  1. IP 黑名單 → 直接 403
  2. Maintenance mode 開 → 非 admin 503
  3. Load shed mode：
       - "off"    永遠不 shed
       - "bypass" 永遠不 shed（緊急回滾用）
       - "on"     強制非 admin 503
       - "auto"   依負載指標決策（active_requests / 5xx ratio / DB pool 使用率）

「是否 admin」純看 JWT extra_claims["is_admin"]，不查 DB（middleware 必須無 I/O）。
JWT claim 被偽造也只能擠進 origin → RBAC 第二道防線會在 router 層擋掉。
"""

from __future__ import annotations

import logging
import random
from collections.abc import Awaitable, Callable

import jwt
from starlette.responses import JSONResponse, Response
from starlette.types import Receive, Scope, Send

from api.core.config import settings
from api.core.database import engine
from api.core.ip_blocklist import is_blocked
from api.core.load_signals import get_5xx_ratio, get_active_requests
from api.core.maintenance import get_load_shed_force_mode, get_maintenance_state
from api.core.metrics import get_db_pool_stats
from api.core.security import decode_token

logger = logging.getLogger(__name__)

# 維護模式 / shed 啟動時，少數路徑要永遠可用：
ALWAYS_ALLOWED_PATHS = frozenset(
    {
        "/health",
        "/live",
        "/ready",
        "/auth/google/login",
        "/auth/google/callback",
        "/auth/refresh",
        "/auth/me",
        "/auth/logout",
    }
)
ALWAYS_ALLOWED_PREFIXES = (
    "/admin/",
    "/docs",
    "/redoc",
    "/openapi.json",
)


def _is_admin_claim(scope: Scope) -> bool:
    """從 cookie / Authorization header 取 access_token，看 JWT is_admin claim。

    不查 DB；不阻塞。若 token 缺失/失效/無 claim → False。
    """
    headers = scope.get("headers") or []
    token: str | None = None
    for k, v in headers:
        lk = k.lower()
        if lk == b"authorization":
            try:
                value = v.decode("latin-1")
            except UnicodeDecodeError:
                continue
            if value.lower().startswith("bearer "):
                token = value[7:].strip()
                break
        elif lk == b"cookie":
            try:
                cookie_header = v.decode("latin-1")
            except UnicodeDecodeError:
                continue
            for part in cookie_header.split(";"):
                k2, _, v2 = part.strip().partition("=")
                if k2 == settings.ACCESS_TOKEN_COOKIE_NAME and v2:
                    token = v2
                    break
            if token:
                break

    if not token:
        return False
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        return False
    return bool(payload.get("is_admin"))


def _client_ip(scope: Scope) -> str:
    client = scope.get("client")
    return client[0] if client else "unknown"


def _is_path_exempt(path: str) -> bool:
    if path in ALWAYS_ALLOWED_PATHS:
        return True
    return any(path.startswith(p) for p in ALWAYS_ALLOWED_PREFIXES)


async def _should_shed_by_signals() -> tuple[bool, str]:
    """auto 模式下，依即時指標判斷是否要 shed。"""
    active = get_active_requests()
    if active > settings.LOAD_SHED_MAX_ACTIVE_REQUESTS:
        return True, f"active_requests={active}"

    ratio = get_5xx_ratio()
    if ratio > settings.LOAD_SHED_5XX_RATIO_THRESHOLD:
        return True, f"5xx_ratio={ratio:.2%}"

    try:
        db_stats = get_db_pool_stats(engine)
        if db_stats.utilization > settings.LOAD_SHED_DB_POOL_THRESHOLD:
            return True, f"db_pool={db_stats.utilization:.2%}"
    except Exception:  # pool stats 失敗不該影響服務
        pass

    return False, ""


class LoadShedMiddleware:
    """高負載時優先讓 admin 通過、其他人 503。

    Pure ASGI middleware；不依賴 BaseHTTPMiddleware（後者會包整個請求耗 buffer）。
    """

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        ip = _client_ip(scope)

        # 1. IP 黑名單：所有路徑（含 /health）都擋
        if await is_blocked(ip):
            await self._respond_blocked(scope, send)
            return

        if _is_path_exempt(path):
            await self.app(scope, receive, send)
            return

        is_admin = _is_admin_claim(scope)

        # 2. Maintenance mode
        maintenance = await get_maintenance_state()
        if maintenance.get("enabled") and not is_admin:
            await self._respond_maintenance(scope, send, maintenance)
            return

        # 3. Load shed
        if settings.LOAD_SHED_ENABLED:
            mode = await get_load_shed_force_mode()
            should_shed = False
            reason = ""
            if mode == "bypass" or mode == "off":
                should_shed = False
            elif mode == "on":
                should_shed = not is_admin
                reason = "force_on"
            else:  # auto
                if not is_admin:
                    auto_shed, reason = await _should_shed_by_signals()
                    should_shed = auto_shed

            if should_shed:
                await self._respond_shed(scope, send, reason)
                return

        await self.app(scope, receive, send)

    async def _respond_blocked(self, scope: Scope, send: Send) -> None:
        resp = JSONResponse(
            {"detail": "您的 IP 已被封鎖，請聯絡管理員"},
            status_code=403,
        )
        await self._send_response(resp, scope, send)

    async def _respond_maintenance(self, scope: Scope, send: Send, state: dict) -> None:
        message = state.get("message") or "系統維護中，請稍後再試"
        resp = JSONResponse(
            {"detail": message, "maintenance": True},
            status_code=503,
            headers={"Retry-After": "60"},
        )
        await self._send_response(resp, scope, send)

    async def _respond_shed(self, scope: Scope, send: Send, reason: str) -> None:
        # 加上隨機 jitter 避免雷鳴效應
        base = settings.LOAD_SHED_RETRY_AFTER_BASE_SECONDS
        retry_after = base + random.randint(0, base * 2)
        logger.info(
            "Load shed: path=%s ip=%s reason=%s retry_after=%d",
            scope.get("path"),
            _client_ip(scope),
            reason,
            retry_after,
        )
        resp = JSONResponse(
            {"detail": "伺服器壅塞，請稍後再試", "load_shed": True},
            status_code=503,
            headers={"Retry-After": str(retry_after)},
        )
        await self._send_response(resp, scope, send)

    async def _send_response(self, resp: Response, scope: Scope, send: Send) -> None:
        async def _noop_receive():
            return {"type": "http.disconnect"}

        await resp(scope, receive=_noop_receive, send=send)
