"""電子證件路由。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.user import User
from api.schemas.electronic_credential import (
    ElectronicCredentialAuthorizationBulkCreate,
    ElectronicCredentialAuthorizationBulkOut,
    ElectronicCredentialAuthorizationCreate,
    ElectronicCredentialAuthorizationOut,
    ElectronicCredentialAuthorizationUpdate,
    ElectronicCredentialOut,
    ElectronicCredentialSettingsOut,
    ElectronicCredentialSettingsUpdate,
)
from api.services import audit as audit_svc
from api.services import electronic_credential as credential_svc

router = APIRouter(prefix="/electronic-credentials", tags=["電子證件"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
ManagerUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.PARTNER_MAP_MANAGE,
            PermissionCode.ELECTRONIC_CREDENTIAL_MANAGE,
        )
    ),
]


@router.get("/me", response_model=ElectronicCredentialOut, summary="取得我的電子證件")
async def get_my_electronic_credential(
    db: DbDep,
    current_user: CurrentUser,
) -> ElectronicCredentialOut:
    credential = await credential_svc.get_my_credential(db, current_user)
    if credential is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="電子證件僅提供符合屆別學號規則的校內學生、校內師長或經特別授權的個人帳號。",
        )
    return credential


@router.get(
    "/admin/settings",
    response_model=ElectronicCredentialSettingsOut,
    summary="取得電子證件資格設定",
)
async def admin_get_settings(db: DbDep, _: ManagerUser) -> ElectronicCredentialSettingsOut:
    return await credential_svc.get_settings(db)


@router.patch(
    "/admin/settings",
    response_model=ElectronicCredentialSettingsOut,
    summary="更新電子證件學生資格設定",
)
async def admin_update_settings(
    body: ElectronicCredentialSettingsUpdate,
    db: DbDep,
    manager: ManagerUser,
) -> ElectronicCredentialSettingsOut:
    settings = await credential_svc.update_settings(db, body, manager.id)
    await audit_svc.record(
        db,
        entity_type="electronic_credential_settings",
        entity_id="1",
        action="electronic_credential.settings_update",
        actor_id=str(manager.id),
        actor_email=manager.email,
        meta=body.model_dump(mode="json"),
        summary="更新電子證件學生資格設定",
    )
    return settings


@router.get(
    "/admin/authorizations",
    response_model=list[ElectronicCredentialAuthorizationOut],
    summary="列出電子證件特殊身分授權",
)
async def admin_list_authorizations(
    db: DbDep,
    _: ManagerUser,
    include_inactive: bool = Query(True),
) -> list[ElectronicCredentialAuthorizationOut]:
    return await credential_svc.list_authorizations(db, include_inactive=include_inactive)


@router.post(
    "/admin/authorizations",
    response_model=ElectronicCredentialAuthorizationOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立電子證件特殊身分授權",
)
async def admin_create_authorization(
    body: ElectronicCredentialAuthorizationCreate,
    db: DbDep,
    manager: ManagerUser,
) -> ElectronicCredentialAuthorizationOut:
    try:
        return await credential_svc.create_authorization(db, body, manager.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post(
    "/admin/authorizations/bulk",
    response_model=ElectronicCredentialAuthorizationBulkOut,
    status_code=status.HTTP_201_CREATED,
    summary="批量建立電子證件特殊身分授權",
)
async def admin_bulk_create_authorizations(
    body: ElectronicCredentialAuthorizationBulkCreate,
    db: DbDep,
    manager: ManagerUser,
) -> ElectronicCredentialAuthorizationBulkOut:
    return await credential_svc.create_authorizations(db, body, manager.id)


@router.patch(
    "/admin/authorizations/{authorization_id}",
    response_model=ElectronicCredentialAuthorizationOut,
    summary="更新電子證件特殊身分授權",
)
async def admin_update_authorization(
    authorization_id: uuid.UUID,
    body: ElectronicCredentialAuthorizationUpdate,
    db: DbDep,
    manager: ManagerUser,
) -> ElectronicCredentialAuthorizationOut:
    authorization = await credential_svc.get_authorization(db, authorization_id)
    if authorization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到授權資料")
    try:
        return await credential_svc.update_authorization(db, authorization, body, manager.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
