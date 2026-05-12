"""組織架構路由 - /orgs"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.org import Org
from api.models.user import User
from api.schemas.org import OrgCreate, OrgRead, OrgTree, OrgUpdate
from api.services import audit as audit_svc
from api.services import org as org_svc
from api.services.permission import get_user_org_ids_with_permission

router = APIRouter(prefix="/orgs", tags=["組織架構"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get("", response_model=list[OrgRead], summary="列出所有組織節點（扁平）")
async def list_orgs(db: DbDep, _: CurrentUser) -> list:
    return await org_svc.get_orgs(db)


@router.get("/tree", response_model=list[OrgTree], summary="取得完整組織樹")
async def get_org_tree(db: DbDep, _: CurrentUser) -> list:
    orgs = await org_svc.get_orgs(db)
    return org_svc.build_org_tree(orgs)


@router.get(
    "/my-create-orgs",
    response_model=list[OrgRead],
    summary="取得當前使用者有權起草公文的組織列表（RBAC 過濾）",
)
async def list_my_create_orgs(db: DbDep, current_user: CurrentUser) -> list:
    """
    回傳使用者在哪些組織擁有 document:create 權限。
    superuser 直接回傳所有組織。
    """
    if current_user.is_superuser:
        return await org_svc.get_orgs(db)
    org_ids = await get_user_org_ids_with_permission(db, current_user.id, "document:create")
    if not org_ids:
        return []
    result = await db.execute(select(Org).where(Org.id.in_(org_ids)).order_by(Org.name))
    return list(result.scalars().all())


@router.get("/{org_id}", response_model=OrgRead, summary="取得單一組織節點")
async def get_org(org_id: uuid.UUID, db: DbDep, _: CurrentUser) -> object:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    return org


@router.post(
    "",
    response_model=OrgRead,
    status_code=status.HTTP_201_CREATED,
    summary="建立組織節點（需 org:manage 或 admin:all）",
    dependencies=[Depends(require_any(PermissionCode.ORG_MANAGE, PermissionCode.ADMIN_ALL))],
)
async def create_org(data: OrgCreate, db: DbDep, current_user: CurrentUser) -> object:
    org = await org_svc.create_org(db, data)
    await audit_svc.record(
        db,
        entity_type="org",
        entity_id=str(org.id),
        action="org.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(mode="json"),
        summary=f"建立組織「{org.name}」",
    )
    return org


@router.patch(
    "/{org_id}",
    response_model=OrgRead,
    summary="更新組織節點（需 org:manage 或 admin:all）",
    dependencies=[Depends(require_any(PermissionCode.ORG_MANAGE, PermissionCode.ADMIN_ALL))],
)
async def update_org(
    org_id: uuid.UUID,
    data: OrgUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    before = {
        "name": org.name,
        "description": org.description,
        "parent_id": str(org.parent_id) if org.parent_id else None,
        "prefix": org.prefix,
    }
    try:
        org = await org_svc.update_org(db, org, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        db,
        entity_type="org",
        entity_id=str(org.id),
        action="org.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "name": org.name,
                "description": org.description,
                "parent_id": str(org.parent_id) if org.parent_id else None,
                "prefix": org.prefix,
            },
        },
        summary=f"更新組織「{org.name}」",
    )
    return org


@router.delete(
    "/{org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除組織節點（需 org:manage 或 admin:all）",
    dependencies=[Depends(require_any(PermissionCode.ORG_MANAGE, PermissionCode.ADMIN_ALL))],
)
async def delete_org(org_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> None:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    await audit_svc.record(
        db,
        entity_type="org",
        entity_id=str(org.id),
        action="org.delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "name": org.name,
            "description": org.description,
            "parent_id": str(org.parent_id) if org.parent_id else None,
            "prefix": org.prefix,
        },
        summary=f"刪除組織「{org.name}」",
    )
    await org_svc.delete_org(db, org)
