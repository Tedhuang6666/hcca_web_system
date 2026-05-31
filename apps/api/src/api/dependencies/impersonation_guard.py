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
    cookie_name = "hcca_access_token"
    return request.cookies.get(cookie_name)


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


__all__ = ["block_impersonation_write"]
