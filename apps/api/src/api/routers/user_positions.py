"""使用者任期路由 - /user-positions"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cache_invalidate
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.org import UserPosition
from api.models.user import User
from api.schemas.org import UserPositionCreate, UserPositionRead, UserPositionUpdate
from api.services import audit as audit_svc
from api.services import org as org_svc
from api.services.permission import get_user_permission_codes

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
    current_user: User = Depends(get_current_active_user),
) -> list:
    if user_id != current_user.id and not current_user.is_superuser:
        codes = await get_user_permission_codes(db, current_user.id)
        if "admin:all" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="無權查詢他人任期資料"
            )
    if active_only:
        ups = await org_svc.get_active_positions_by_date(db, user_id)
    else:
        ups = await org_svc.get_user_positions(db, user_id)
    return [UserPositionRead.from_orm_with_details(up) for up in ups]


@router.get("/me", response_model=list[UserPositionRead], summary="取得當前使用者的任期記錄")
async def my_positions(
    active_only: bool = Query(True, description="僅回傳今日仍在任的記錄"),
    on_date: date | None = Query(None, description="查詢特定日期的在任狀態"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list:
    if active_only or on_date:
        ups = await org_svc.get_active_positions_by_date(db, current_user.id, on_date)
    else:
        ups = await org_svc.get_user_positions(db, current_user.id)
    return [UserPositionRead.from_orm_with_details(up) for up in ups]


@router.post(
    "",
    response_model=UserPositionRead,
    status_code=status.HTTP_201_CREATED,
    summary="新增任期記錄",
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def create_user_position(
    data: UserPositionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> object:
    if data.end_date and data.end_date < data.start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date 不能早於 start_date",
        )
    up = await org_svc.create_user_position(db, data)
    await audit_svc.record(
        db,
        entity_type="user_position",
        entity_id=str(up.id),
        action="position.assign",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(mode="json"),
        summary="新增使用者任期記錄",
    )
    await cache_invalidate(f"perm:{up.user_id}")
    ups = await org_svc.get_active_positions_by_date(db, up.user_id)
    matched = next((x for x in ups if x.id == up.id), None)
    return UserPositionRead.from_orm_with_details(matched or up)


@router.patch(
    "/{up_id}",
    response_model=UserPositionRead,
    summary="更新任期結束日（卸任）",
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def update_user_position(
    up_id: uuid.UUID,
    data: UserPositionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
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
    before = {
        "start_date": up.start_date.isoformat(),
        "end_date": up.end_date.isoformat() if up.end_date else None,
    }
    up = await org_svc.update_user_position(db, up, data)
    await audit_svc.record(
        db,
        entity_type="user_position",
        entity_id=str(up.id),
        action="position.term_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "start_date": up.start_date.isoformat(),
                "end_date": up.end_date.isoformat() if up.end_date else None,
            },
        },
        summary="更新使用者任期",
    )
    await cache_invalidate(f"perm:{up.user_id}")
    return up


@router.delete(
    "/{up_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除任期記錄",
    dependencies=[Depends(require_permission(PermissionCode.ADMIN_ALL))],
)
async def delete_user_position(
    up_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    result = await db.execute(select(UserPosition).where(UserPosition.id == up_id))
    up = result.scalar_one_or_none()
    if not up:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任期記錄不存在")
    await audit_svc.record(
        db,
        entity_type="user_position",
        entity_id=str(up.id),
        action="position.unassign",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "user_id": str(up.user_id),
            "position_id": str(up.position_id),
            "start_date": up.start_date.isoformat(),
            "end_date": up.end_date.isoformat() if up.end_date else None,
        },
        summary="刪除使用者任期記錄",
    )
    await cache_invalidate(f"perm:{up.user_id}")
    await db.delete(up)
