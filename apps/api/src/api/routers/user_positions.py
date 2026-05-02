"""使用者任期路由 - /user-positions"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.org import UserPosition
from api.models.user import User
from api.schemas.org import UserPositionCreate, UserPositionRead, UserPositionUpdate
from api.services import org as org_svc

router = APIRouter(prefix="/user-positions", tags=["任期管理"])


@router.get(
    "",
    response_model=list[UserPositionRead],
    summary="查詢使用者任期記錄",
)
async def list_user_positions(
    user_id: uuid.UUID = Query(..., description="目標使用者 ID"),
    active_only: bool = Query(False, description="僅回傳今日仍在任的記錄"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> list:
    if active_only:
        return await org_svc.get_active_positions_by_date(db, user_id)
    return await org_svc.get_user_positions(db, user_id)


@router.get("/me", response_model=list[UserPositionRead], summary="取得當前使用者的任期記錄")
async def my_positions(
    active_only: bool = Query(True, description="僅回傳今日仍在任的記錄"),
    on_date: date | None = Query(None, description="查詢特定日期的在任狀態"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list:
    if active_only or on_date:
        return await org_svc.get_active_positions_by_date(db, current_user.id, on_date)
    return await org_svc.get_user_positions(db, current_user.id)


@router.post(
    "",
    response_model=UserPositionRead,
    status_code=status.HTTP_201_CREATED,
    summary="新增任期記錄",
)
async def create_user_position(
    data: UserPositionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    if data.end_date and data.end_date < data.start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date 不能早於 start_date",
        )
    return await org_svc.create_user_position(db, data)


@router.patch(
    "/{up_id}",
    response_model=UserPositionRead,
    summary="更新任期結束日（卸任）",
)
async def update_user_position(
    up_id: uuid.UUID,
    data: UserPositionUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> object:
    result = await db.execute(select(UserPosition).where(UserPosition.id == up_id))
    up = result.scalar_one_or_none()
    if not up:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任期記錄不存在")
    if data.end_date and data.end_date < up.start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date 不能早於 start_date",
        )
    return await org_svc.update_user_position(db, up, data)


@router.delete(
    "/{up_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除任期記錄",
)
async def delete_user_position(
    up_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_active_user),
) -> None:
    result = await db.execute(select(UserPosition).where(UserPosition.id == up_id))
    up = result.scalar_one_or_none()
    if not up:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任期記錄不存在")
    await db.delete(up)
