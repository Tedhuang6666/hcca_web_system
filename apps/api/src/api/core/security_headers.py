"""安全標頭 middleware。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """為所有 HTTP 回應加上瀏覽器層安全標頭。"""

    def __init__(
        self,
        app: Callable,
        *,
        enabled: bool = True,
        hsts_enabled: bool = False,
        hsts_max_age: int = 31_536_000,
        content_security_policy: str | None = None,
    ) -> None:
        super().__init__(app)
        self.enabled = enabled
        self.hsts_enabled = hsts_enabled
        self.hsts_max_age = hsts_max_age
        self.content_security_policy = content_security_policy

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        if not self.enabled:
            return response

        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if self.content_security_policy:
            response.headers.setdefault("Content-Security-Policy", self.content_security_policy)
        if self.hsts_enabled:
            response.headers.setdefault(
                "Strict-Transport-Security",
                f"max-age={self.hsts_max_age}; includeSubDomains",
            )
        return response
