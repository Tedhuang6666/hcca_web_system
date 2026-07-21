"""組織架構路由 - /orgs"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cache_get, cache_invalidate, cache_set
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.org import Org
from api.models.user import User
from api.schemas.org import OrgCreate, OrgRead, OrgTree, OrgUpdate
from api.services import audit as audit_svc
from api.services import org as org_svc
from api.services.permission import (
    get_user_org_ids_with_any_permission,
    get_user_org_ids_with_permission,
    get_user_permission_codes,
)

router = APIRouter(prefix="/orgs", tags=["組織架構"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get("", response_model=list[OrgRead], summary="列出所有組織節點（扁平）")
async def list_orgs(
    db: DbDep,
    _: CurrentUser,
    active_only: bool = Query(False, description="僅回傳啟用中的組織"),
    exclude_class_orgs: bool = Query(False, description="排除班級系統自動建立的組織"),
) -> list:
    # 檢查快取
    cache_key = f"org:list:active_only={active_only}"
    if not exclude_class_orgs:
        cached = await cache_get(cache_key)
        if cached is not None:
            return cached

    # 查詢並序列化
    orgs = await org_svc.get_orgs(
        db,
        active_only=active_only,
        exclude_class_orgs=exclude_class_orgs,
    )
    result = [OrgRead.model_validate(o).model_dump(mode="json") for o in orgs]

    # 快取 300 秒
    if not exclude_class_orgs:
        await cache_set(cache_key, result, ttl=300)
    return result


@router.get("/tree", response_model=list[OrgTree], summary="取得完整組織樹")
async def get_org_tree(db: DbDep, _: CurrentUser) -> list:
    # 檢查快取
    cached = await cache_get("org:tree")
    if cached is not None:
        return cached

    # 查詢並構建樹狀結構
    orgs = await org_svc.get_orgs(db)
    tree = org_svc.build_org_tree(orgs)
    result = [OrgTree.model_validate(t).model_dump(mode="json") for t in tree]

    # 快取 300 秒
    await cache_set("org:tree", result, ttl=300)
    return result


@router.get(
    "/my-create-orgs",
    response_model=list[OrgRead],
    summary="取得當前使用者有權起草公文的組織列表（RBAC 過濾）",
)
async def list_my_create_orgs(db: DbDep, current_user: CurrentUser) -> list:
    """
    回傳使用者在哪些組織擁有 document:create 或 document:draft 權限。
    superuser 直接回傳所有組織。
    """
    if current_user.is_superuser:
        result = await db.execute(select(Org).where(Org.is_active.is_(True)).order_by(Org.name))
        return list(result.scalars().all())
    org_ids = await get_user_org_ids_with_any_permission(
        db, current_user.id, {"document:create", "document:draft"}
    )
    if not org_ids:
        return []
    result = await db.execute(
        select(Org).where(Org.id.in_(org_ids), Org.is_active.is_(True)).order_by(Org.name)
    )
    return list(result.scalars().all())


@router.get(
    "/my-regulation-create-orgs",
    response_model=list[OrgRead],
    summary="取得當前使用者有權起草法規的組織列表（RBAC 過濾）",
)
async def list_my_regulation_create_orgs(db: DbDep, current_user: CurrentUser) -> list:
    """
    回傳使用者在哪些組織擁有 regulation:create 權限。
    superuser 直接回傳所有組織。
    """
    if current_user.is_superuser:
        result = await db.execute(select(Org).where(Org.is_active.is_(True)).order_by(Org.name))
        return list(result.scalars().all())
    org_ids = await get_user_org_ids_with_permission(db, current_user.id, "regulation:create")
    if not org_ids:
        return []
    result = await db.execute(
        select(Org).where(Org.id.in_(org_ids), Org.is_active.is_(True)).order_by(Org.name)
    )
    return list(result.scalars().all())


@router.get(
    "/my-serial-template-orgs",
    response_model=list[OrgRead],
    summary="取得當前使用者可管理字號模板的組織列表（RBAC 過濾）",
)
async def list_my_serial_template_orgs(db: DbDep, current_user: CurrentUser) -> list:
    """
    回傳使用者在哪些組織擁有 serial:create 權限。
    superuser 或 admin:all 直接回傳所有組織。
    """
    if current_user.is_superuser:
        result = await db.execute(select(Org).where(Org.is_active.is_(True)).order_by(Org.name))
        return list(result.scalars().all())
    codes = await get_user_permission_codes(db, current_user.id)
    if "admin:all" in codes:
        result = await db.execute(select(Org).where(Org.is_active.is_(True)).order_by(Org.name))
        return list(result.scalars().all())
    org_ids = await get_user_org_ids_with_permission(db, current_user.id, "serial:create")
    if not org_ids:
        return []
    result = await db.execute(
        select(Org).where(Org.id.in_(org_ids), Org.is_active.is_(True)).order_by(Org.name)
    )
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
    # 清除快存
    await cache_invalidate("org:list")
    await cache_invalidate("org:list:active_only=False")
    await cache_invalidate("org:list:active_only=True")
    await cache_invalidate("org:tree")
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
        "bill_stage": org.bill_stage,
        "leader_user_id": str(org.leader_user_id) if org.leader_user_id else None,
        "is_active": org.is_active,
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
                "bill_stage": org.bill_stage,
                "leader_user_id": str(org.leader_user_id) if org.leader_user_id else None,
                "is_active": org.is_active,
            },
        },
        summary=f"更新組織「{org.name}」",
    )
    # 清除快存
    await cache_invalidate("org:list")
    await cache_invalidate("org:list:active_only=False")
    await cache_invalidate("org:list:active_only=True")
    await cache_invalidate("org:tree")
    return org


@router.post(
    "/{org_id}/deactivate",
    response_model=OrgRead,
    summary="停用組織節點（需 org:manage 或 admin:all）",
    dependencies=[Depends(require_any(PermissionCode.ORG_MANAGE, PermissionCode.ADMIN_ALL))],
)
async def deactivate_org(org_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> object:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    before = {"is_active": org.is_active}
    org = await org_svc.set_org_active(db, org, False)
    await audit_svc.record(
        db,
        entity_type="org",
        entity_id=str(org.id),
        action="org.deactivate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"before": before, "after": {"is_active": org.is_active}},
        summary=f"停用組織「{org.name}」",
    )
    # 清除快存
    await cache_invalidate("org:list")
    await cache_invalidate("org:list:active_only=False")
    await cache_invalidate("org:list:active_only=True")
    await cache_invalidate("org:tree")
    return org


@router.post(
    "/{org_id}/activate",
    response_model=OrgRead,
    summary="啟用組織節點（需 org:manage 或 admin:all）",
    dependencies=[Depends(require_any(PermissionCode.ORG_MANAGE, PermissionCode.ADMIN_ALL))],
)
async def activate_org(org_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> object:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    before = {"is_active": org.is_active}
    org = await org_svc.set_org_active(db, org, True)
    await audit_svc.record(
        db,
        entity_type="org",
        entity_id=str(org.id),
        action="org.activate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"before": before, "after": {"is_active": org.is_active}},
        summary=f"啟用組織「{org.name}」",
    )
    # 清除快存
    await cache_invalidate("org:list")
    await cache_invalidate("org:list:active_only=False")
    await cache_invalidate("org:list:active_only=True")
    await cache_invalidate("org:tree")
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
    if await org_svc.org_has_documents_or_regulations(db, org.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="此組織仍關聯公文或法規，無法刪除；請改為停用組織",
        )
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
    try:
        await org_svc.delete_org(db, org)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="此組織仍被其他資料引用，無法刪除；請改為停用組織",
        ) from e

    # 清除快存
    await cache_invalidate("org:list")
    await cache_invalidate("org:list:active_only=False")
    await cache_invalidate("org:list:active_only=True")
    await cache_invalidate("org:tree")
