"""安全審計中間件 - 記錄敏感操作"""

from __future__ import annotations

import logging
from contextvars import ContextVar
from datetime import UTC, datetime
from urllib.parse import parse_qsl

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)
logger.propagate = True
_audit_actor: ContextVar[tuple[str, str] | None] = ContextVar("audit_actor", default=None)


def set_audit_actor(user_id: str, user_email: str) -> None:
    _audit_actor.set((user_id, user_email))


def clear_audit_actor() -> None:
    _audit_actor.set(None)


def _client_ip(scope: Scope) -> str:
    client = scope.get("client")
    return client[0] if client else "unknown"


def _query_params(scope: Scope) -> dict[str, str]:
    query_string = scope.get("query_string") or b""
    if not query_string:
        return {}
    return dict(parse_qsl(query_string.decode("latin-1")))


class SecurityAuditMiddleware:
    """
    安全審計中間件：記錄敏感操作（管理員操作、權限變更、資料修改等）

    Pure ASGI；不依賴 BaseHTTPMiddleware（後者每個請求都多開一層 anyio task group）。
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

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    def _is_sensitive(self, method: str, path: str) -> bool:
        """檢查是否為敏感操作"""
        if method not in {"POST", "PATCH", "PUT", "DELETE"}:
            return False

        return any(path.startswith(prefix) for prefix in self.SENSITIVE_ENDPOINTS)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        method = str(scope.get("method", "GET")).upper()
        path = scope.get("path", "")
        if scope["type"] != "http" or not self._is_sensitive(method, path):
            await self.app(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        client_ip = _client_ip(scope)
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                actor = _audit_actor.get()
                user = state.get("user")
                user_id = (
                    actor[0]
                    if actor is not None
                    else str(user.id)
                    if user is not None
                    else "anonymous"
                )
                user_email = (
                    actor[1] if actor is not None else user.email if user is not None else "unknown"
                )

                # 記錄敏感操作（info level；失敗時 status_code >= 400 方升為 warning）
                log_fn = logger.warning if status_code >= 400 else logger.info
                log_fn(
                    "Security audit: sensitive operation",
                    extra={
                        "timestamp": datetime.now(UTC).isoformat(),
                        "method": method,
                        "path": path,
                        "user_id": user_id,
                        "user_email": user_email,
                        "client_ip": client_ip,
                        "status_code": status_code,
                        "query_params": _query_params(scope),
                    },
                )
                clear_audit_actor()
            await send(message)

        await self.app(scope, receive, send_wrapper)


__all__ = ["SecurityAuditMiddleware", "set_audit_actor"]
