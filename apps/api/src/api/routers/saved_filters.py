"""Saved filters router - user search presets"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.saved_filter import SavedFilter
from api.models.user import User
from api.schemas.saved_filter import SavedFilterCreate, SavedFilterOut, SavedFilterUpdate

router = APIRouter(prefix="/saved-filters", tags=["常用篩選"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get("", response_model=list[SavedFilterOut], summary="列出我的常用篩選")
async def list_saved_filters(
    session: DbDep,
    user: CurrentUser,
    scope: str | None = Query(
        None, max_length=50, description="可選：documents/regulations/judicial"
    ),
) -> list[SavedFilter]:
    q = select(SavedFilter).where(SavedFilter.user_id == user.id)
    if scope:
        q = q.where(SavedFilter.scope == scope)
    q = q.order_by(SavedFilter.updated_at.desc())
    result = await session.execute(q)
    return list(result.scalars().all())


@router.post(
    "", response_model=SavedFilterOut, status_code=status.HTTP_201_CREATED, summary="建立常用篩選"
)
async def create_saved_filter(
    body: SavedFilterCreate,
    session: DbDep,
    user: CurrentUser,
) -> SavedFilter:
    sf = SavedFilter(
        user_id=user.id,
        scope=body.scope,
        name=body.name,
        description=body.description,
        params=body.params or {},
        share_path=body.share_path,
    )
    session.add(sf)
    await session.flush()
    return sf


@router.patch("/{filter_id}", response_model=SavedFilterOut, summary="更新常用篩選")
async def update_saved_filter(
    filter_id: uuid.UUID,
    body: SavedFilterUpdate,
    session: DbDep,
    user: CurrentUser,
) -> SavedFilter:
    result = await session.execute(
        select(SavedFilter).where(SavedFilter.id == filter_id, SavedFilter.user_id == user.id)
    )
    sf = result.scalar_one_or_none()
    if sf is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此常用篩選")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(sf, k, v)
    await session.flush()
    return sf


@router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除常用篩選")
async def delete_saved_filter(
    filter_id: uuid.UUID,
    session: DbDep,
    user: CurrentUser,
) -> None:
    result = await session.execute(
        select(SavedFilter).where(SavedFilter.id == filter_id, SavedFilter.user_id == user.id)
    )
    sf = result.scalar_one_or_none()
    if sf is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此常用篩選")
    await session.delete(sf)
    await session.flush()
