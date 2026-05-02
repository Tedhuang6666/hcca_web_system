"""RBAC 依賴注入 - PermissionChecker 與 require_permission 工廠"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services.permission import get_user_permission_codes


class PermissionChecker:
    """
    FastAPI 依賴注入式 RBAC 權限檢查器。

    使用方式（路由層）：
        @router.post("/docs", dependencies=[Depends(require_permission("document:create"))])

    或直接注入取得通過驗證的使用者：
        @router.post("/docs")
        async def create_doc(user: User = Depends(require_permission("document:create"))):
            ...
    """

    def __init__(self, required_permission: str) -> None:
        self.required_permission = required_permission

    async def __call__(
        self,
        current_user: User = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        codes = await get_user_permission_codes(db, current_user.id)
        if self.required_permission not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要權限：{self.required_permission}",
            )
        return current_user


def require_permission(permission_code: str) -> PermissionChecker:
    """
    工廠函式，建立針對特定權限碼的 PermissionChecker。

    範例：
        from api.dependencies.permissions import require_permission

        @router.delete(
            "/{doc_id}",
            dependencies=[Depends(require_permission("document:delete"))],
        )
        async def delete_document(...): ...
    """
    return PermissionChecker(permission_code)


class AnyPermissionChecker:
    """
    檢查使用者是否擁有多個權限碼中的任意一個（OR 邏輯）。

    使用方式：
        @router.get("/report", dependencies=[Depends(require_any("finance:view", "admin:all"))])
    """

    def __init__(self, *permissions: str) -> None:
        self.permissions = set(permissions)

    async def __call__(
        self,
        current_user: User = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        codes = await get_user_permission_codes(db, current_user.id)
        if not codes & self.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要下列權限之一：{', '.join(sorted(self.permissions))}",
            )
        return current_user


def require_any(*permission_codes: str) -> AnyPermissionChecker:
    """工廠函式，建立 OR 邏輯的 AnyPermissionChecker"""
    return AnyPermissionChecker(*permission_codes)
