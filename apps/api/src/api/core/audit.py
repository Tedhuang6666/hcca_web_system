"""安全審計中間件 - 記錄敏感操作"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)


class SecurityAuditMiddleware(BaseHTTPMiddleware):
    """
    安全審計中間件：記錄敏感操作（管理員操作、權限變更、資料修改等）
    """

    # 需要審計的端點前綴（POST/PATCH/DELETE 操作）
    SENSITIVE_ENDPOINTS = [
        "/admin/",
        "/documents/",
        "/regulations/",
        "/approvals/",
        "/user-positions/",
        "/positions/",
        "/orgs/",
        "/users/",
    ]

    def __init__(self, app: Callable) -> None:
        super().__init__(app)

    def _is_sensitive(self, method: str, path: str) -> bool:
        """檢查是否為敏感操作"""
        if method not in {"POST", "PATCH", "PUT", "DELETE"}:
            return False

        return any(path.startswith(prefix) for prefix in self.SENSITIVE_ENDPOINTS)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if not self._is_sensitive(request.method, request.url.path):
            return await call_next(request)

        # 提取使用者資訊（若可用）
        user_id = "anonymous"
        user_email = "unknown"
        try:
            # 嘗試從 token 提取使用者（簡化版，實際可能需要解碼 JWT）
            if hasattr(request.state, "user"):
                user_id = str(request.state.user.id)
                user_email = request.state.user.email
        except Exception:  # nosec B110
            pass

        client_ip = request.client.host if request.client else "unknown"

        # 執行請求
        response = await call_next(request)

        # 記錄敏感操作（info level；失敗時 status_code >= 400 方升為 warning）
        log_fn = logger.warning if response.status_code >= 400 else logger.info
        log_fn(
            "Security audit: sensitive operation",
            extra={
                "timestamp": datetime.now(UTC).isoformat(),
                "method": request.method,
                "path": request.url.path,
                "user_id": user_id,
                "user_email": user_email,
                "client_ip": client_ip,
                "status_code": response.status_code,
                "query_params": dict(request.query_params),
            },
        )

        return response
