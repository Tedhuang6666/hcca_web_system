"""CSRF 保護中間件 - 防止跨站請求偽造"""

from __future__ import annotations

import logging
import secrets

from starlette.datastructures import MutableHeaders
from starlette.requests import cookie_parser
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _header_value(headers: list[tuple[bytes, bytes]], name: bytes) -> str | None:
    lowered = name.lower()
    for key, value in headers:
        if key.lower() == lowered:
            try:
                return value.decode("latin-1")
            except UnicodeDecodeError:
                return None
    return None


def _cookies(scope: Scope) -> dict[str, str]:
    headers = scope.get("headers") or []
    cookies: dict[str, str] = {}
    for key, value in headers:
        if key.lower() == b"cookie":
            try:
                cookies.update(cookie_parser(value.decode("latin-1")))
            except UnicodeDecodeError:
                continue
    return cookies


def _client_ip(scope: Scope) -> str:
    client = scope.get("client")
    return client[0] if client else "unknown"


class CSRFMiddleware:
    """
    Double-Submit Cookie 模式 CSRF 保護：
    - GET 請求：設置可讓 JS 讀取的 csrf_token cookie（非 httponly）
    - POST/PATCH/PUT/DELETE：驗證 X-CSRF-Token header 與 csrf_token cookie 一致
    - 只讀取 header，不讀取 body

    Pure ASGI；不依賴 BaseHTTPMiddleware（後者每個請求都多開一層 anyio task group）。
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        enabled: bool = True,
        token_header_name: str = "X-CSRF-Token",
        token_cookie_name: str = "csrf_token",
        secure: bool = False,
        exempt_paths: list[str] | None = None,
    ) -> None:
        self.app = app
        self.enabled = enabled
        self.token_header_name = token_header_name
        self.token_cookie_name = token_cookie_name
        self.secure = secure
        self.exempt_paths = exempt_paths or [
            "/health",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/auth/google/login",
            "/auth/google/callback",
            "/auth/google/one-tap",
            "/line/webhook",
            "/email/resend/webhook",
            # 內部服務使用 API key，不依賴瀏覽器 cookie。
            "/internal/discord",
            # 退訂端點以簽章 token 保護，免登入且無 CSRF cookie，故豁免
            "/notifications/unsubscribe",
        ]

    def _is_exempt(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in self.exempt_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.enabled or self._is_exempt(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method", "GET")).upper()

        if method in SAFE_METHODS:
            await self._pass_through_safe(scope, receive, send)
            return

        if method in UNSAFE_METHODS:
            headers = scope.get("headers") or []
            stored_token = _cookies(scope).get(self.token_cookie_name)
            header_token = _header_value(headers, self.token_header_name.encode())

            if not stored_token or not header_token:
                logger.warning(
                    "CSRF token missing",
                    extra={
                        "method": method,
                        "path": scope.get("path"),
                        "has_cookie": bool(stored_token),
                        "has_header": bool(header_token),
                        "client_ip": _client_ip(scope),
                    },
                )
                response = JSONResponse(
                    {"detail": "CSRF 驗證失敗，請重新整理頁面"}, status_code=403
                )
                await response(scope, receive, send)
                return

            if not secrets.compare_digest(stored_token, header_token):
                logger.warning(
                    "CSRF token mismatch",
                    extra={
                        "method": method,
                        "path": scope.get("path"),
                        "client_ip": _client_ip(scope),
                    },
                )
                response = JSONResponse({"detail": "CSRF 驗證失敗"}, status_code=403)
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)

    async def _pass_through_safe(self, scope: Scope, receive: Receive, send: Send) -> None:
        needs_cookie = not _cookies(scope).get(self.token_cookie_name)

        async def send_wrapper(message: Message) -> None:
            if needs_cookie and message["type"] == "http.response.start":
                token = secrets.token_urlsafe(32)
                dummy = Response()
                dummy.set_cookie(
                    self.token_cookie_name,
                    token,
                    httponly=False,  # 必須讓 JS 能讀取
                    secure=self.secure,
                    samesite="strict",
                    max_age=3600 * 24,
                )
                set_cookie_header = _header_value(dummy.raw_headers, b"set-cookie")
                if set_cookie_header is not None:
                    headers = MutableHeaders(raw=list(message.get("headers") or []))
                    headers.append("set-cookie", set_cookie_header)
                    message = {**message, "headers": headers.raw}
            await send(message)

        await self.app(scope, receive, send_wrapper)


__all__ = ["SAFE_METHODS", "UNSAFE_METHODS", "CSRFMiddleware"]
