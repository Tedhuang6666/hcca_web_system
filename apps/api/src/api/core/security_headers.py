"""安全標頭 middleware。"""

from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class SecurityHeadersMiddleware:
    """為所有 HTTP 回應加上瀏覽器層安全標頭。

    Pure ASGI；不依賴 BaseHTTPMiddleware（後者每個請求都多開一層 anyio task group）。
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        enabled: bool = True,
        hsts_enabled: bool = False,
        hsts_max_age: int = 31_536_000,
        content_security_policy: str | None = None,
    ) -> None:
        self.app = app
        self.enabled = enabled
        self.hsts_enabled = hsts_enabled
        self.hsts_max_age = hsts_max_age
        self.content_security_policy = content_security_policy

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.enabled:
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=list(message.get("headers") or []))
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
                headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
                if self.content_security_policy:
                    headers.setdefault("Content-Security-Policy", self.content_security_policy)
                if self.hsts_enabled:
                    headers.setdefault(
                        "Strict-Transport-Security",
                        f"max-age={self.hsts_max_age}; includeSubDomains",
                    )
                message = {**message, "headers": headers.raw}
            await send(message)

        await self.app(scope, receive, send_wrapper)
