"""角色視角導覽設定 router。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.schemas.navigation_profile import (
    NavigationProfileCreate,
    NavigationProfileOut,
    NavigationProfileResolveOut,
    NavigationProfileUpdate,
)
from api.services import navigation_profile as service

router = APIRouter(prefix="/admin/navigation-profiles", tags=["管理員 / 視角管理"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
AdminDep = Depends(require_permission(PermissionCode.ADMIN_ALL))


@router.get("", response_model=list[NavigationProfileOut], dependencies=[AdminDep])
async def list_navigation_profiles(
    db: DbDep,
    include_inactive: bool = Query(True),
) -> list[NavigationProfileOut]:
    return await service.list_profiles(db, include_inactive=include_inactive)


@router.get("/me", response_model=NavigationProfileResolveOut)
async def resolve_my_navigation_profile(
    db: DbDep, current_user: CurrentUser
) -> NavigationProfileResolveOut:
    return await service.resolve_for_user(db, current_user)


@router.post(
    "",
    response_model=NavigationProfileOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[AdminDep],
)
async def create_navigation_profile(
    body: NavigationProfileCreate,
    db: DbDep,
) -> NavigationProfileOut:
    try:
        return await service.create_profile(db, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch("/{profile_id}", response_model=NavigationProfileOut, dependencies=[AdminDep])
async def update_navigation_profile(
    profile_id: uuid.UUID,
    body: NavigationProfileUpdate,
    db: DbDep,
) -> NavigationProfileOut:
    profile = await service.get_profile(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="視角不存在")
    try:
        return await service.update_profile(db, profile, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[AdminDep])
async def delete_navigation_profile(profile_id: uuid.UUID, db: DbDep) -> None:
    profile = await service.get_profile(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="視角不存在")
    if profile.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="系統預設視角不可刪除")
    await service.delete_profile(db, profile)
