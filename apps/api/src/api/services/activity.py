"""活動服務層 - CRUD 與活動總召授權查詢"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.models.user import User
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
    check_date = on_date or local_today()
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


async def is_active_convener(
    db: AsyncSession,
    user_id: uuid.UUID,
    activity_id: uuid.UUID,
    *,
    on_date: date | None = None,
) -> bool:
    check_date = on_date or local_today()
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
