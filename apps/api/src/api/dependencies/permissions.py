"""RBAC 依賴注入 - PermissionChecker 與 require_permission 工廠"""

from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services.permission import get_user_permission_codes, get_user_permission_codes_for_org


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

    def __init__(self, required_permission: str | PermissionCode) -> None:
        self.required_permission = str(required_permission)

    async def __call__(
        self,
        current_user: User = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        # 超級管理員繞過所有 RBAC 檢查
        if current_user.is_superuser:
            return current_user
        codes = await get_user_permission_codes(db, current_user.id)
        if self.required_permission not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要權限：{self.required_permission}",
            )
        return current_user


def require_permission(permission_code: str | PermissionCode) -> PermissionChecker:
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

    def __init__(self, *permissions: str | PermissionCode) -> None:
        self.permissions = {str(code) for code in permissions}

    async def __call__(
        self,
        current_user: User = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        # 超級管理員繞過所有 RBAC 檢查
        if current_user.is_superuser:
            return current_user
        codes = await get_user_permission_codes(db, current_user.id)
        if not codes & self.permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要下列權限之一：{', '.join(sorted(self.permissions))}",
            )
        return current_user


def require_any(*permission_codes: str | PermissionCode) -> AnyPermissionChecker:
    """工廠函式，建立 OR 邏輯的 AnyPermissionChecker"""
    return AnyPermissionChecker(*permission_codes)


class OrgScopedPermissionChecker:
    """
    檢查使用者在指定 org_id 資源範圍內是否有權限。

    使用方式（router 層）：
        dependencies=[Depends(require_org_permission("document:create"))]

    預設從 path/query/body 的 `org_id` 取資源範圍；若 route 參數名稱不同，
    可傳入 org_param，例如 `require_org_permission("x", org_param="target_org_id")`。
    """

    def __init__(
        self, required_permission: str | PermissionCode, org_param: str = "org_id"
    ) -> None:
        self.required_permission = str(required_permission)
        self.org_param = org_param

    async def __call__(
        self,
        request: Request,
        current_user: User = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if current_user.is_superuser:
            return current_user
        raw_org_id = request.path_params.get(self.org_param) or request.query_params.get(
            self.org_param
        )
        if raw_org_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"缺少資源範圍：{self.org_param}",
            )
        try:
            org_id = uuid.UUID(str(raw_org_id))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"資源範圍格式錯誤：{self.org_param}",
            ) from exc
        codes = await get_user_permission_codes_for_org(db, current_user.id, org_id)
        if self.required_permission not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要組織範圍權限：{self.required_permission}",
            )
        return current_user


def require_org_permission(
    permission_code: str | PermissionCode,
    *,
    org_param: str = "org_id",
) -> OrgScopedPermissionChecker:
    return OrgScopedPermissionChecker(permission_code, org_param=org_param)


class AdminMFAChecker:
    """
    強制管理員必須啟用 MFA 才能進入後台。對應 Phase A4。

    使用方式（path operation decorator 層）：
        @router.get(
            "/admin/users",
            dependencies=[Depends(require_admin_mfa)],
        )

    或作為複合依賴：本依賴會先確認 user 已通過 auth，再檢查 mfa_enabled。
    超級管理員（is_superuser）不繞過此檢查，避免「最高權限者反而最弱」。
    """

    async def __call__(
        self,
        current_user: User = Depends(get_current_active_user),
    ) -> User:
        if not current_user.mfa_enabled:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="管理員必須啟用 MFA 才能存取此資源，請至 /mfa/setup 完成設定",
                headers={"X-MFA-Required": "true"},
            )
        return current_user


require_admin_mfa = AdminMFAChecker()
