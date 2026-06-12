"""菜單排程 / 菜單品項 / 自動結單"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.meal import MealOrderItem, MenuItem, MenuSchedule
from api.schemas.meal import MenuItemCreate, MenuItemUpdate, MenuScheduleCreate, MenuScheduleUpdate
from api.services._base import apply_updates
from api.services.meal._vendor import get_vendor

logger = logging.getLogger(__name__)


# ── 菜單排程 CRUD ─────────────────────────────────────────────────────────────


async def get_schedule(session: AsyncSession, schedule_id: uuid.UUID) -> MenuSchedule | None:
    result = await session.execute(
        select(MenuSchedule)
        .options(selectinload(MenuSchedule.items))
        .where(MenuSchedule.id == schedule_id)
    )
    return result.scalar_one_or_none()


async def list_schedules(
    session: AsyncSession,
    *,
    vendor_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    is_closed: bool | None = None,
    limit: int = 30,
    offset: int = 0,
) -> list[MenuSchedule]:
    q = select(MenuSchedule).order_by(MenuSchedule.date.desc())
    if vendor_id:
        q = q.where(MenuSchedule.vendor_id == vendor_id)
    if date_from:
        q = q.where(MenuSchedule.date >= date_from)
    if date_to:
        q = q.where(MenuSchedule.date <= date_to)
    if is_closed is not None:
        q = q.where(MenuSchedule.is_closed == is_closed)
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_schedule(
    session: AsyncSession, *, data: MenuScheduleCreate, created_by: uuid.UUID
) -> MenuSchedule:
    vendor = await get_vendor(session, data.vendor_id)
    if vendor is None or not vendor.is_active:
        raise ValueError("找不到此商家或商家已停用")

    if data.order_deadline <= datetime.now(UTC):
        raise ValueError("結單時間必須晚於現在")

    if data.order_open_time and data.order_open_time >= data.order_deadline:
        raise ValueError("開放訂餐時間必須早於結單時間")

    schedule = MenuSchedule(
        vendor_id=data.vendor_id,
        date=data.date,
        order_open_time=data.order_open_time,
        order_deadline=data.order_deadline,
        note=data.note,
        created_by=created_by,
    )
    session.add(schedule)
    await session.flush()
    logger.info("菜單排程建立 id=%s vendor=%s date=%s", schedule.id, data.vendor_id, data.date)
    return schedule


async def update_schedule(
    session: AsyncSession, schedule: MenuSchedule, *, data: MenuScheduleUpdate
) -> MenuSchedule:
    if schedule.is_closed:
        raise ValueError("已結單的排程不能修改")
    apply_updates(schedule, data, exclude_none=True)
    await session.flush()
    return schedule


async def close_schedule(session: AsyncSession, schedule: MenuSchedule) -> MenuSchedule:
    """手動結單（商家或系統均可呼叫）"""
    if schedule.is_closed:
        raise ValueError("此排程已結單")
    schedule.is_closed = True
    await session.flush()
    logger.info("菜單排程結單 id=%s date=%s", schedule.id, schedule.date)
    return schedule


# ── 菜單品項 CRUD ─────────────────────────────────────────────────────────────


async def get_menu_item(session: AsyncSession, item_id: uuid.UUID) -> MenuItem | None:
    result = await session.execute(select(MenuItem).where(MenuItem.id == item_id))
    return result.scalar_one_or_none()


async def add_menu_item(
    session: AsyncSession, schedule: MenuSchedule, *, data: MenuItemCreate
) -> MenuItem:
    if schedule.is_closed:
        raise ValueError("已結單的排程不能新增品項")
    item = MenuItem(
        schedule_id=schedule.id,
        name=data.name,
        description=data.description,
        price=data.price,
        max_quantity=data.max_quantity,
    )
    session.add(item)
    await session.flush()
    return item


async def update_menu_item(
    session: AsyncSession, item: MenuItem, *, data: MenuItemUpdate
) -> MenuItem:
    schedule = await session.get(MenuSchedule, item.schedule_id)
    if schedule and schedule.is_closed:
        raise ValueError("已結單的排程不能修改品項")
    apply_updates(item, data, exclude_none=True)
    await session.flush()
    return item


async def delete_menu_item(session: AsyncSession, item: MenuItem) -> None:
    schedule = await session.get(MenuSchedule, item.schedule_id)
    if schedule and schedule.is_closed:
        raise ValueError("已結單的排程不能刪除品項")
    count_result = await session.execute(
        select(func.count()).where(MealOrderItem.menu_item_id == item.id)
    )
    if count_result.scalar_one() > 0:
        raise ValueError("此品項已有訂單，不能刪除")
    await session.delete(item)
    await session.flush()


# ── 自動結單（供 Celery Beat 呼叫）──────────────────────────────────────────────


async def auto_close_expired_schedules(session: AsyncSession) -> int:
    """
    關閉所有已過結單截止時間且尚未結單的排程。
    返回關閉的排程數量。
    """
    now = datetime.now(UTC)
    q = (
        select(MenuSchedule)
        .where(MenuSchedule.is_closed == False)  # noqa: E712
        .where(MenuSchedule.order_deadline <= now)
    )
    result = await session.execute(q)
    schedules = result.scalars().all()

    count = 0
    for schedule in schedules:
        schedule.is_closed = True
        count += 1

    if count:
        await session.flush()
        logger.info("自動結單：共關閉 %d 個排程", count)
    return count
