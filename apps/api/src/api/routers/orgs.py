"""組織架構路由 - /orgs"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.org import OrgCreate, OrgRead, OrgTree, OrgUpdate
from api.services import org as org_svc

router = APIRouter(prefix="/orgs", tags=["組織架構"])


@router.get("", response_model=list[OrgRead], summary="列出所有組織節點（扁平）")
async def list_orgs(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> list:
    return await org_svc.get_orgs(db)


@router.get("/tree", response_model=list[OrgTree], summary="取得完整組織樹")
async def get_org_tree(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> list:
    orgs = await org_svc.get_orgs(db)
    return org_svc.build_org_tree(orgs)


@router.get("/{org_id}", response_model=OrgRead, summary="取得單一組織節點")
async def get_org(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    return org


@router.post(
    "", response_model=OrgRead, status_code=status.HTTP_201_CREATED, summary="建立組織節點"
)
async def create_org(
    data: OrgCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    return await org_svc.create_org(db, data)


@router.patch("/{org_id}", response_model=OrgRead, summary="更新組織節點")
async def update_org(
    org_id: uuid.UUID,
    data: OrgUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    return await org_svc.update_org(db, org, data)


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除組織節點")
async def delete_org(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> None:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    await org_svc.delete_org(db, org)
