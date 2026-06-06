"""Impersonation read-only guard。Phase C3。

對所有 unsafe HTTP method（POST/PATCH/PUT/DELETE）在 router 層注入此 dependency，
當 request token 為 impersonation token 時 raise 403。

例外白名單（仍允許）：
- POST /admin/impersonate/end             結束 impersonation
- POST /auth/logout                       登出
- 任何 GET / HEAD / OPTIONS                read 不受影響

建議掛法：在 router 級別加上：
    @router.post(..., dependencies=[Depends(block_impersonation_write)])

或全域：在 [api/__init__.py] 加一個 middleware（本檔提供）。
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from api.core.config import settings
from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services import impersonation as impersonation_svc

logger = logging.getLogger(__name__)

WRITE_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})
ALLOWED_PATHS_DURING_IMPERSONATION = (
    "/admin/impersonate/end",
    "/auth/logout",
)


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("authorization") or ""
    parts = auth.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip() or None
    return request.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)


async def block_impersonation_write(
    request: Request,
    current_user: Annotated[User, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """在 router decorator 用此 dep；impersonation 模式下嘗試寫入會 raise 403。"""
    if request.method not in WRITE_METHODS:
        return current_user
    if any(request.url.path.startswith(p) for p in ALLOWED_PATHS_DURING_IMPERSONATION):
        return current_user

    token = _extract_token(request)
    if not token:
        return current_user
    claims = impersonation_svc.parse_impersonation_token(token)
    if claims is None:
        return current_user

    # 寫 audit log（best effort、不阻擋）
    try:
        await impersonation_svc.record_blocked_write(
            db,
            actor_id=str(claims.get("imp") or ""),
            target_user_id=str(claims.get("sub") or ""),
            method=request.method,
            path=request.url.path,
        )
        await db.commit()
    except Exception:
        logger.exception("impersonation_blocked_write audit log failed")
        await db.rollback()

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="impersonation 模式為唯讀，不允許寫入操作",
        headers={"X-Impersonation-Readonly": "true"},
    )


class ImpersonationReadOnlyMiddleware(BaseHTTPMiddleware):
    """全域強制 impersonation 唯讀。

    `block_impersonation_write` 是 router 層 dependency，需逐路由掛載，極易漏掛而
    形同未啟用。改以 middleware 全域生效：任何寫入方法只要帶的是 impersonation
    token（純 JWT 解碼即可判斷，不需 DB），即回 403。只會「增加」403、不會放寬任何
    既有授權，故掛上絕對安全。audit log 仍由 router 層 dependency 負責（best effort）。
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in WRITE_METHODS:
            return await call_next(request)
        if any(request.url.path.startswith(p) for p in ALLOWED_PATHS_DURING_IMPERSONATION):
            return await call_next(request)

        token = _extract_token(request)
        if token and impersonation_svc.parse_impersonation_token(token) is not None:
            logger.info("impersonation write blocked: %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "impersonation 模式為唯讀，不允許寫入操作"},
                headers={"X-Impersonation-Readonly": "true"},
            )
        return await call_next(request)


__all__ = ["ImpersonationReadOnlyMiddleware", "block_impersonation_write"]
