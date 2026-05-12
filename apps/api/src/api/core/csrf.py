"""CSRF 保護中間件 - 防止跨站請求偽造"""

import logging
import secrets
from collections.abc import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class CSRFMiddleware(BaseHTTPMiddleware):
    """
    Double-Submit Cookie 模式 CSRF 保護：
    - GET 請求：設置可讓 JS 讀取的 csrf_token cookie（非 httponly）
    - POST/PATCH/PUT/DELETE：驗證 X-CSRF-Token header 與 csrf_token cookie 一致
    - 只讀取 header，不讀取 body，避免 BaseHTTPMiddleware 的 body-consuming 問題
    """

    def __init__(
        self,
        app: Callable,
        *,
        enabled: bool = True,
        token_header_name: str = "X-CSRF-Token",
        token_cookie_name: str = "csrf_token",
        secure: bool = False,
        exempt_paths: list[str] | None = None,
    ) -> None:
        super().__init__(app)
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
            "/auth/refresh",
            "/line/webhook",
        ]

    def _is_exempt(self, path: str) -> bool:
        return any(path.startswith(prefix) for prefix in self.exempt_paths)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not self.enabled or self._is_exempt(request.url.path):
            return await call_next(request)

        if request.method in SAFE_METHODS:
            response = await call_next(request)
            # 若尚無 CSRF token，設置（非 httponly，讓前端 JS 能讀取並附入 header）
            if not request.cookies.get(self.token_cookie_name):
                token = secrets.token_urlsafe(32)
                response.set_cookie(
                    self.token_cookie_name,
                    token,
                    httponly=False,  # 必須讓 JS 能讀取
                    secure=self.secure,
                    samesite="strict",
                    max_age=3600 * 24,
                )
            return response

        if request.method in UNSAFE_METHODS:
            stored_token = request.cookies.get(self.token_cookie_name)
            header_token = request.headers.get(self.token_header_name)

            if not stored_token or not header_token:
                logger.warning(
                    "CSRF token missing",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "has_cookie": bool(stored_token),
                        "has_header": bool(header_token),
                        "client_ip": request.client.host if request.client else "unknown",
                    },
                )
                return JSONResponse({"detail": "CSRF 驗證失敗，請重新整理頁面"}, status_code=403)

            if not secrets.compare_digest(stored_token, header_token):
                logger.warning(
                    "CSRF token mismatch",
                    extra={
                        "method": request.method,
                        "path": request.url.path,
                        "client_ip": request.client.host if request.client else "unknown",
                    },
                )
                return JSONResponse({"detail": "CSRF 驗證失敗"}, status_code=403)

        return await call_next(request)
