"""職位與權限路由 - /orgs/{org_id}/positions, /positions/{id}/permissions"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.org import Org, Permission
from api.models.user import User
from api.schemas.org import (
    PermissionCreate,
    PermissionRead,
    PositionCreate,
    PositionRead,
    PositionUpdate,
)
from api.services import org as org_svc

router = APIRouter(tags=["職位與權限"])


# ── Position (nested under /orgs) ─────────────────────────────────────────────


@router.get(
    "/orgs/{org_id}/positions",
    response_model=list[PositionRead],
    summary="列出組織的所有職位",
)
async def list_positions(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> list:
    org = await org_svc.get_org(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    return await org_svc.get_positions(db, org_id)


@router.post(
    "/orgs/{org_id}/positions",
    response_model=PositionRead,
    status_code=status.HTTP_201_CREATED,
    summary="在組織下新增職位",
)
async def create_position(
    org_id: uuid.UUID,
    data: PositionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    result = await db.execute(select(Org).where(Org.id == org_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織節點不存在")
    return await org_svc.create_position(db, org_id, data)


@router.get("/positions/{position_id}", response_model=PositionRead, summary="取得職位詳情")
async def get_position(
    position_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    position = await org_svc.get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    return position


@router.patch("/positions/{position_id}", response_model=PositionRead, summary="更新職位")
async def update_position(
    position_id: uuid.UUID,
    data: PositionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    position = await org_svc.get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    return await org_svc.update_position(db, position, data)


@router.delete(
    "/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除職位"
)
async def delete_position(
    position_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> None:
    position = await org_svc.get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    await org_svc.delete_position(db, position)


# ── Permission (nested under /positions) ──────────────────────────────────────


@router.post(
    "/positions/{position_id}/permissions",
    response_model=PermissionRead,
    status_code=status.HTTP_201_CREATED,
    summary="新增權限碼至職位",
)
async def add_permission(
    position_id: uuid.UUID,
    data: PermissionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    position = await org_svc.get_position(db, position_id)
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    return await org_svc.add_permission(db, position_id, data)


@router.delete(
    "/permissions/{permission_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除權限碼",
)
async def remove_permission(
    permission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> None:
    result = await db.execute(select(Permission).where(Permission.id == permission_id))
    perm = result.scalar_one_or_none()
    if not perm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="權限碼不存在")
    await org_svc.remove_permission(db, perm)
