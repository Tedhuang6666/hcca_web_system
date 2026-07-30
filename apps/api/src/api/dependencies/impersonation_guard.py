"""Impersonation request context。

Impersonation token 會讓下游以目標使用者進行 RBAC 與資料存取；本模組只負責把
token 內的管理員／目標雙重身分放進 request context，讓所有 audit writer 自動標註代行者。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from api.core.config import settings
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services import impersonation as impersonation_svc


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("authorization") or ""
    parts = auth.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip() or None
    return request.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)


async def block_impersonation_write(
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """相容舊路由注入點；代行模式現在允許依目標權限執行寫入。"""
    return current_user


class ImpersonationContextMiddleware(BaseHTTPMiddleware):
    """在整個請求生命週期提供代行者與目標使用者的雙重身分。"""

    _INTERACTIVE_BLOCKED_PREFIXES = (
        "/admin",
        "/finance",
        "/elections",
        "/governance",
        "/regulations",
        "/documents",
        "/support",
        "/system",
    )

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        context_token = None
        token = _extract_token(request)
        claims = impersonation_svc.parse_impersonation_token(token) if token else None
        if (
            claims is not None
            and claims.get("support_read_only")
            and request.method
            not in {
                "GET",
                "HEAD",
                "OPTIONS",
            }
        ):
            return JSONResponse(
                {"detail": "目前為客服唯讀模擬模式，不允許提交或修改資料"},
                status_code=403,
            )
        if (
            claims is not None
            and claims.get("support_interactive")
            and request.url.path.startswith(self._INTERACTIVE_BLOCKED_PREFIXES)
        ):
            return JSONResponse(
                {"detail": "客服可操作模擬不允許進入財務、投票、權限或管理區域"},
                status_code=403,
            )
        context = (
            impersonation_svc.impersonation_context_from_claims(claims)
            if claims is not None
            else None
        )
        if context is not None:
            context_token = impersonation_svc.set_impersonation_context(context)

        try:
            return await call_next(request)
        finally:
            if context_token is not None:
                impersonation_svc.reset_impersonation_context(context_token)


__all__ = ["ImpersonationContextMiddleware", "block_impersonation_write"]
