"""活動服務層 - CRUD 與活動總召授權查詢"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.models.user import User
from api.schemas.activity import (
    ActivityConvenerCreate,
    ActivityConvenerUpdate,
    ActivityCreate,
    ActivityUpdate,
)
from api.services.permission import get_user_permission_codes


def _active_convener_filter(check_date: date) -> list:
    return [
        ActivityConvener.start_date <= check_date,
        (ActivityConvener.end_date.is_(None)) | (ActivityConvener.end_date >= check_date),
    ]


async def get_activity(db: AsyncSession, activity_id: uuid.UUID) -> Activity | None:
    result = await db.execute(
        select(Activity)
        .where(Activity.id == activity_id)
        .options(selectinload(Activity.conveners).selectinload(ActivityConvener.user))
    )
    return result.scalar_one_or_none()


async def list_activities(
    db: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    active_only: bool = False,
) -> list[Activity]:
    query = select(Activity).order_by(
        Activity.starts_at.desc().nullslast(), Activity.created_at.desc()
    )
    if org_id is not None:
        query = query.where(Activity.org_id == org_id)
    if active_only:
        query = query.where(
            Activity.is_active.is_(True), Activity.status != ActivityStatus.ARCHIVED
        )
    result = await db.execute(query)
    return list(result.scalars().all())


async def list_user_convener_activities(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    active_only: bool = True,
    on_date: date | None = None,
) -> list[Activity]:
    check_date = on_date or date.today()
    query = (
        select(Activity)
        .join(ActivityConvener, ActivityConvener.activity_id == Activity.id)
        .where(ActivityConvener.user_id == user_id, *_active_convener_filter(check_date))
        .order_by(Activity.starts_at.desc().nullslast(), Activity.created_at.desc())
        .distinct()
    )
    if active_only:
        query = query.where(
            Activity.is_active.is_(True), Activity.status != ActivityStatus.ARCHIVED
        )
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_activity(db: AsyncSession, data: ActivityCreate) -> Activity:
    activity = Activity(**data.model_dump())
    db.add(activity)
    await db.flush()
    await db.refresh(activity)
    return activity


async def update_activity(db: AsyncSession, activity: Activity, data: ActivityUpdate) -> Activity:
    fields = data.model_dump(exclude_unset=True)
    starts_at = fields.get("starts_at", activity.starts_at)
    ends_at = fields.get("ends_at", activity.ends_at)
    if starts_at and ends_at and ends_at < starts_at:
        raise ValueError("活動結束時間不可早於開始時間")
    for field, value in fields.items():
        setattr(activity, field, value)
    await db.flush()
    await db.refresh(activity)
    return activity


async def archive_activity(db: AsyncSession, activity: Activity) -> Activity:
    activity.status = ActivityStatus.ARCHIVED
    activity.is_active = False
    await db.flush()
    await db.refresh(activity)
    return activity


async def appoint_convener(
    db: AsyncSession, activity: Activity, data: ActivityConvenerCreate
) -> ActivityConvener:
    result = await db.execute(select(User.id).where(User.id == data.user_id))
    if result.scalar_one_or_none() is None:
        raise ValueError("指定的使用者不存在")
    new_end = data.end_date or date.max
    overlap = await db.execute(
        select(ActivityConvener.id)
        .where(
            ActivityConvener.activity_id == activity.id,
            ActivityConvener.user_id == data.user_id,
            ActivityConvener.start_date <= new_end,
            (ActivityConvener.end_date.is_(None)) | (ActivityConvener.end_date >= data.start_date),
        )
        .limit(1)
    )
    if overlap.scalar_one_or_none() is not None:
        raise ValueError("此使用者在該活動已有重疊的總召任期")
    convener = ActivityConvener(activity_id=activity.id, **data.model_dump())
    db.add(convener)
    await db.flush()
    await db.refresh(convener, ["user"])
    return convener


async def list_conveners(db: AsyncSession, activity_id: uuid.UUID) -> list[ActivityConvener]:
    result = await db.execute(
        select(ActivityConvener)
        .where(ActivityConvener.activity_id == activity_id)
        .options(selectinload(ActivityConvener.user))
        .order_by(ActivityConvener.start_date.desc())
    )
    return list(result.scalars().all())


async def get_convener(db: AsyncSession, convener_id: uuid.UUID) -> ActivityConvener | None:
    result = await db.execute(
        select(ActivityConvener)
        .where(ActivityConvener.id == convener_id)
        .options(selectinload(ActivityConvener.user))
    )
    return result.scalar_one_or_none()


async def update_convener(
    db: AsyncSession, convener: ActivityConvener, data: ActivityConvenerUpdate
) -> ActivityConvener:
    fields = data.model_dump(exclude_unset=True)
    start = fields.get("start_date", convener.start_date)
    end = fields.get("end_date", convener.end_date)
    if end and end < start:
        raise ValueError("總召任期結束日不可早於開始日")
    for field, value in fields.items():
        setattr(convener, field, value)
    await db.flush()
    await db.refresh(convener, ["user"])
    return convener


async def remove_convener(db: AsyncSession, convener: ActivityConvener) -> None:
    await db.delete(convener)
    await db.flush()


async def is_active_convener(
    db: AsyncSession,
    user_id: uuid.UUID,
    activity_id: uuid.UUID,
    *,
    on_date: date | None = None,
) -> bool:
    check_date = on_date or date.today()
    result = await db.execute(
        select(ActivityConvener.id)
        .join(Activity, Activity.id == ActivityConvener.activity_id)
        .where(
            ActivityConvener.user_id == user_id,
            ActivityConvener.activity_id == activity_id,
            Activity.is_active.is_(True),
            Activity.status != ActivityStatus.ARCHIVED,
            *_active_convener_filter(check_date),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def can_manage_activity_resource(
    db: AsyncSession,
    user: User,
    activity_id: uuid.UUID | None,
) -> bool:
    """Router 層使用：判定使用者是否可管理指定活動底下的資源。"""
    if activity_id is None:
        return False
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes(db, user.id)
    if "admin:all" in codes:
        return True
    return await is_active_convener(db, user.id, activity_id)
