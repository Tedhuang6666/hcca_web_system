"""職位與權限路由 - /orgs/{org_id}/positions, /positions/{id}/permissions"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any, require_permission
from api.models.org import Org, Permission
from api.models.user import User
from api.schemas.org import (
    PermissionCreate,
    PermissionRead,
    PositionCreate,
    PositionRead,
    PositionUpdate,
)
from api.services import audit as audit_svc
from api.services import org as org_svc

router = APIRouter(tags=["職位與權限"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


# ── Position (nested under /orgs) ─────────────────────────────────────────────


@router.get(
    "/orgs/{org_id}/positions",
    response_model=list[PositionRead],
    summary="列出組織的所有職位（登入即可）",
)
async def list_positions(org_id: uuid.UUID, db: DbDep, _: CurrentUser) -> list:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    return await org_svc.get_positions(db, org_id)


@router.post(
    "/orgs/{org_id}/positions",
    response_model=PositionRead,
    status_code=status.HTTP_201_CREATED,
    summary="在組織下新增職位（需 org:manage_positions 或 admin:all）",
    dependencies=[
        Depends(require_any(PermissionCode.ORG_MANAGE_POSITIONS, PermissionCode.ADMIN_ALL))
    ],
)
async def create_position(
    org_id: uuid.UUID,
    data: PositionCreate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    result = await db.execute(select(Org).where(Org.id == org_id))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    if not org.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="組織已停用，無法建立職位")
    position = await org_svc.create_position(db, org_id, data)
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(position.id),
        action="position.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"org_id": str(org.id), "org_name": org.name, **data.model_dump(mode="json")},
        summary=f"在「{org.name}」建立職位「{position.name}」",
    )
    return position


@router.get(
    "/positions/{position_id}",
    response_model=PositionRead,
    summary="取得職位詳情（登入即可）",
)
async def get_position(position_id: uuid.UUID, db: DbDep, _: CurrentUser) -> object:
    position = await org_svc.get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    return position


@router.patch(
    "/positions/{position_id}",
    response_model=PositionRead,
    summary="更新職位（需 org:manage_positions 或 admin:all）",
    dependencies=[
        Depends(require_any(PermissionCode.ORG_MANAGE_POSITIONS, PermissionCode.ADMIN_ALL))
    ],
)
async def update_position(
    position_id: uuid.UUID,
    data: PositionUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    position = await org_svc.get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    before = {
        "name": position.name,
        "description": position.description,
        "parent_id": str(position.parent_id) if position.parent_id else None,
    }
    try:
        position = await org_svc.update_position(db, position, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(position.id),
        action="position.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "name": position.name,
                "description": position.description,
                "parent_id": str(position.parent_id) if position.parent_id else None,
            },
        },
        summary=f"更新職位「{position.name}」",
    )
    return position


@router.delete(
    "/positions/{position_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除職位（需 org:manage_positions 或 admin:all）",
    dependencies=[
        Depends(require_any(PermissionCode.ORG_MANAGE_POSITIONS, PermissionCode.ADMIN_ALL))
    ],
)
async def delete_position(position_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> None:
    position = await org_svc.get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(position.id),
        action="position.delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"name": position.name, "org_id": str(position.org_id)},
        summary=f"刪除職位「{position.name}」",
    )
    await org_svc.delete_position(db, position)


# ── Permission (nested under /positions) ──────────────────────────────────────


@router.post(
    "/positions/{position_id}/permissions",
    response_model=PermissionRead,
    status_code=status.HTTP_201_CREATED,
    summary="新增權限碼至職位（需 admin:all）",
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def add_permission(
    position_id: uuid.UUID,
    data: PermissionCreate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    position = await org_svc.get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    permission = await org_svc.add_permission(db, position_id, data)
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(position.id),
        action="permission.assign",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"permission_id": str(permission.id), "code": data.code},
        summary=f"新增權限「{data.code}」至職位「{position.name}」",
    )
    return permission


@router.delete(
    "/permissions/{permission_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除權限碼（需 admin:all）",
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def remove_permission(
    permission_id: uuid.UUID,
    db: DbDep,
    current_user: CurrentUser,
) -> None:
    result = await db.execute(select(Permission).where(Permission.id == permission_id))
    perm = result.scalar_one_or_none()
    if not perm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="權限碼不存在")
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(perm.position_id),
        action="permission.remove",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"permission_id": str(perm.id), "code": perm.code},
        summary=f"移除職位權限「{perm.code}」",
    )
    await org_svc.remove_permission(db, perm)
