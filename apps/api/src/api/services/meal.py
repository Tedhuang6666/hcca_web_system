"""學餐訂購系統服務層 - 商家管理 / 菜單排程 / 訂單建立 / 報表匯出"""

from __future__ import annotations

import io
import logging
import secrets
import uuid
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.meal import (
    MealClassPickupCode,
    MealOrder,
    MealOrderItem,
    MealOrderStatus,
    MealPickupSlot,
    MealPickupStatus,
    MealProduct,
    MealProductAvailability,
    MealVendor,
    MealVendorApplication,
    MealVendorManager,
    MealVendorStatus,
    MenuItem,
    MenuSchedule,
)
from api.models.org import Org
from api.schemas.meal import (
    MealAvailabilityCreate,
    MealOrderCreate,
    MealProductCreate,
    MealProductUpdate,
    MealVendorApplicationCreate,
    MealVendorApplicationReview,
    MealVendorCreate,
    MealVendorUpdate,
    MealWeeklyAvailabilityCreate,
    MenuItemCreate,
    MenuItemUpdate,
    MenuScheduleCreate,
    MenuScheduleUpdate,
)
from api.services import school_class as class_svc

logger = logging.getLogger(__name__)


# ── 序號 / 取餐代碼生成 ───────────────────────────────────────────────────────


async def generate_meal_serial(session: AsyncSession) -> str:
    """
    使用 PostgreSQL Sequence 原子性生成學餐訂單字號：MEAL-YYYY-NNNNNN。
    Sequence `meal_serial_seq` 在 Alembic migration 中建立。
    """
    result = await session.execute(text("SELECT nextval('meal_serial_seq')"))
    seq_val: int = result.scalar_one()
    year = datetime.now(UTC).year
    return f"MEAL-{year}-{seq_val:06d}"


async def generate_pickup_code(session: AsyncSession, max_attempts: int = 10) -> str:
    """
    生成唯一 5 位數取餐代碼（10000–99999）。
    碰撞機率極低（每日訂單 << 90000），最多重試 10 次後拋出例外。
    """
    import random

    for _ in range(max_attempts):
        code = str(random.randint(10000, 99999))  # noqa: S311 (非密碼學用途)
        exists = await session.execute(
            select(MealOrder.id).where(MealOrder.pickup_code == code).limit(1)
        )
        if exists.scalar_one_or_none() is None:
            return code
    raise RuntimeError("無法生成唯一取餐代碼，請稍後再試")


async def generate_class_pickup_code(session: AsyncSession, max_attempts: int = 10) -> str:
    for _ in range(max_attempts):
        code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8].upper()
        exists = await session.scalar(
            select(MealClassPickupCode.id).where(MealClassPickupCode.code == code)
        )
        if exists is None:
            return code
    raise RuntimeError("無法生成班級領取碼，請稍後再試")


# ── 商家 CRUD ─────────────────────────────────────────────────────────────────


async def _get_or_create_vendor_root_org(session: AsyncSession) -> Org:
    root = await session.scalar(select(Org).where(Org.name == "學餐商家", Org.parent_id.is_(None)))
    if root is None:
        root = Org(name="學餐商家", description="學餐平台自動建立的商家組織群")
        session.add(root)
        await session.flush()
    return root


async def _create_vendor_org(session: AsyncSession, vendor_name: str) -> uuid.UUID:
    root = await _get_or_create_vendor_root_org(session)
    org = Org(
        name=f"商家：{vendor_name}",
        description="學餐商家自動建立的 RBAC 組織",
        parent_id=root.id,
    )
    session.add(org)
    await session.flush()
    return org.id


async def get_vendor(session: AsyncSession, vendor_id: uuid.UUID) -> MealVendor | None:
    result = await session.execute(select(MealVendor).where(MealVendor.id == vendor_id))
    return result.scalar_one_or_none()


async def list_vendors(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    active_only: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> list[MealVendor]:
    q = select(MealVendor)
    if org_id:
        q = q.where(MealVendor.org_id == org_id)
    if active_only:
        q = q.where(MealVendor.is_active == True)  # noqa: E712
        q = q.where(MealVendor.status == MealVendorStatus.APPROVED)
    q = q.order_by(MealVendor.name).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_vendor(
    session: AsyncSession, *, data: MealVendorCreate, created_by: uuid.UUID
) -> MealVendor:
    org_id = data.org_id or await _create_vendor_org(session, data.name)
    vendor = MealVendor(
        name=data.name,
        description=data.description,
        contact_phone=data.contact_phone,
        contact_email=data.contact_email,
        org_id=org_id,
        created_by=created_by,
        status=data.status or MealVendorStatus.APPROVED,
    )
    session.add(vendor)
    await session.flush()
    if data.manager_email:
        await assign_vendor_manager(session, vendor, str(data.manager_email))
    logger.info("商家建立 id=%s name=%s", vendor.id, vendor.name)
    return vendor


async def create_vendor_application(
    session: AsyncSession, *, data: MealVendorApplicationCreate
) -> MealVendorApplication:
    payload = data.model_dump()
    payload["org_id"] = data.org_id or await _create_vendor_org(session, data.name)
    app = MealVendorApplication(**payload, status=MealVendorStatus.PENDING_REVIEW)
    session.add(app)
    await session.flush()
    return app


async def list_vendor_applications(
    session: AsyncSession, *, status: str | None = None, limit: int = 50, offset: int = 0
) -> list[MealVendorApplication]:
    q = select(MealVendorApplication).order_by(MealVendorApplication.created_at.desc())
    if status:
        q = q.where(MealVendorApplication.status == status)
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def review_vendor_application(
    session: AsyncSession,
    app: MealVendorApplication,
    *,
    data: MealVendorApplicationReview,
    reviewer_id: uuid.UUID,
) -> MealVendorApplication:
    if app.status != MealVendorStatus.PENDING_REVIEW:
        raise ValueError("此申請已審核，不能重複處理")
    app.status = MealVendorStatus.APPROVED if data.approved else MealVendorStatus.REJECTED
    app.review_note = data.review_note
    app.reviewed_by_id = reviewer_id
    app.reviewed_at = datetime.now(UTC)
    if data.approved:
        vendor = MealVendor(
            name=app.name,
            description=app.description,
            contact_phone=app.contact_phone,
            contact_email=app.contact_email,
            org_id=app.org_id,
            created_by=reviewer_id,
            status=MealVendorStatus.APPROVED,
            is_active=True,
        )
        session.add(vendor)
        await session.flush()
        app.vendor_id = vendor.id
    await session.flush()
    return app


async def get_vendor_application(
    session: AsyncSession, application_id: uuid.UUID
) -> MealVendorApplication | None:
    return await session.get(MealVendorApplication, application_id)


async def is_vendor_manager(session: AsyncSession, vendor_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    exists = await session.scalar(
        select(MealVendorManager.id).where(
            MealVendorManager.vendor_id == vendor_id,
            MealVendorManager.user_id == user_id,
            MealVendorManager.is_active.is_(True),
        )
    )
    return exists is not None


async def list_vendor_managers(
    session: AsyncSession, vendor_id: uuid.UUID
) -> list[MealVendorManager]:
    result = await session.execute(
        select(MealVendorManager)
        .options(selectinload(MealVendorManager.user))
        .where(MealVendorManager.vendor_id == vendor_id, MealVendorManager.is_active.is_(True))
        .order_by(MealVendorManager.created_at)
    )
    return list(result.scalars().all())


async def remove_vendor_manager(
    session: AsyncSession, vendor_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    manager = await session.scalar(
        select(MealVendorManager).where(
            MealVendorManager.vendor_id == vendor_id,
            MealVendorManager.user_id == user_id,
            MealVendorManager.is_active.is_(True),
        )
    )
    if manager is None:
        return False
    manager.is_active = False
    await session.flush()
    return True


async def list_products(
    session: AsyncSession,
    *,
    vendor_id: uuid.UUID | None = None,
    active_only: bool = True,
    limit: int = 100,
    offset: int = 0,
) -> list[MealProduct]:
    q = select(MealProduct).order_by(MealProduct.created_at.desc())
    if vendor_id:
        q = q.where(MealProduct.vendor_id == vendor_id)
    if active_only:
        q = q.where(MealProduct.is_active.is_(True))
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def get_product(session: AsyncSession, product_id: uuid.UUID) -> MealProduct | None:
    return await session.get(MealProduct, product_id)


async def create_product(session: AsyncSession, *, data: MealProductCreate) -> MealProduct:
    vendor = await get_vendor(session, data.vendor_id)
    if vendor is None or vendor.status != MealVendorStatus.APPROVED:
        raise ValueError("找不到此商家或商家尚未審核通過")
    product = MealProduct(**data.model_dump())
    session.add(product)
    await session.flush()
    return product


async def update_product(
    session: AsyncSession, product: MealProduct, *, data: MealProductUpdate
) -> MealProduct:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    await session.flush()
    return product


def _combine_service_time(service_date: date, hhmm: str | None) -> datetime | None:
    if not hhmm:
        return None
    hour, minute = [int(part) for part in hhmm.split(":", 1)]
    return datetime.combine(service_date, time(hour=hour, minute=minute), tzinfo=UTC)


async def create_availability(
    session: AsyncSession, *, data: MealAvailabilityCreate
) -> MealProductAvailability:
    product = await get_product(session, data.product_id)
    if product is None or not product.is_active:
        raise ValueError("找不到商品或已停用")
    availability = MealProductAvailability(
        product_id=product.id,
        vendor_id=product.vendor_id,
        service_date=data.service_date,
        sale_start=data.sale_start,
        sale_end=data.sale_end,
        price=data.price if data.price is not None else product.price,
        max_quantity=(
            data.max_quantity if data.max_quantity is not None else product.default_max_quantity
        ),
        note=data.note,
    )
    availability.product = product
    for slot in data.pickup_slots:
        if slot.order_deadline >= slot.pickup_start:
            raise ValueError("取餐時段的訂購截止時間必須早於取餐開始時間")
        if slot.pickup_end <= slot.pickup_start:
            raise ValueError("取餐結束時間必須晚於開始時間")
        availability.pickup_slots.append(MealPickupSlot(**slot.model_dump()))
    session.add(availability)
    await session.flush()
    return availability


async def bulk_create_weekly_availabilities(
    session: AsyncSession, *, data: MealWeeklyAvailabilityCreate
) -> list[MealProductAvailability]:
    if data.date_to < data.date_from:
        raise ValueError("結束日期不可早於開始日期")
    products = (
        await session.execute(select(MealProduct).where(MealProduct.id.in_(data.product_ids)))
    ).scalars().all()
    product_by_id = {product.id: product for product in products}
    if len(product_by_id) != len(set(data.product_ids)):
        raise ValueError("包含不存在的商品")
    created: list[MealProductAvailability] = []
    day = data.date_from
    while day <= data.date_to:
        if day.weekday() in data.weekdays:
            for product_id in data.product_ids:
                product = product_by_id[product_id]
                availability = MealProductAvailability(
                    product_id=product.id,
                    vendor_id=product.vendor_id,
                    service_date=day,
                    sale_start=_combine_service_time(day, data.sale_start_time),
                    sale_end=_combine_service_time(day, data.sale_end_time),
                    price=product.price,
                    max_quantity=product.default_max_quantity,
                )
                availability.product = product
                for slot in data.pickup_slots:
                    availability.pickup_slots.append(MealPickupSlot(**slot.model_dump()))
                session.add(availability)
                created.append(availability)
        day += timedelta(days=1)
    await session.flush()
    return created


async def list_availabilities(
    session: AsyncSession,
    *,
    vendor_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    active_only: bool = True,
    limit: int = 100,
    offset: int = 0,
) -> list[MealProductAvailability]:
    q = (
        select(MealProductAvailability)
        .options(
            selectinload(MealProductAvailability.product),
            selectinload(MealProductAvailability.pickup_slots),
        )
        .order_by(MealProductAvailability.service_date, MealProductAvailability.created_at)
    )
    if vendor_id:
        q = q.where(MealProductAvailability.vendor_id == vendor_id)
    if date_from:
        q = q.where(MealProductAvailability.service_date >= date_from)
    if date_to:
        q = q.where(MealProductAvailability.service_date <= date_to)
    if active_only:
        q = q.where(MealProductAvailability.is_available.is_(True))
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


async def get_pickup_slot(session: AsyncSession, slot_id: uuid.UUID) -> MealPickupSlot | None:
    result = await session.execute(
        select(MealPickupSlot)
        .options(
            selectinload(MealPickupSlot.availability).selectinload(
                MealProductAvailability.product
            )
        )
        .where(MealPickupSlot.id == slot_id)
    )
    return result.scalar_one_or_none()


async def update_vendor(
    session: AsyncSession, vendor: MealVendor, *, data: MealVendorUpdate
) -> MealVendor:
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(vendor, field, value)
    await session.flush()
    return vendor


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
    # 驗證商家存在且啟用
    vendor = await get_vendor(session, data.vendor_id)
    if vendor is None or not vendor.is_active:
        raise ValueError("找不到此商家或商家已停用")

    # 驗證結單時間合理（必須晚於現在）
    if data.order_deadline <= datetime.now(UTC):
        raise ValueError("結單時間必須晚於現在")

    # 若設定開放時間，必須早於結單時間
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
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(schedule, field, value)
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
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(item, field, value)
    await session.flush()
    return item


async def delete_menu_item(session: AsyncSession, item: MenuItem) -> None:
    schedule = await session.get(MenuSchedule, item.schedule_id)
    if schedule and schedule.is_closed:
        raise ValueError("已結單的排程不能刪除品項")
    # 確認無訂單引用（防止 FK 錯誤）
    from sqlalchemy import func

    count_result = await session.execute(
        select(func.count()).where(MealOrderItem.menu_item_id == item.id)
    )
    if count_result.scalar_one() > 0:
        raise ValueError("此品項已有訂單，不能刪除")
    await session.delete(item)
    await session.flush()


# ── 訂單 CRUD ─────────────────────────────────────────────────────────────────


async def get_meal_order(session: AsyncSession, order_id: uuid.UUID) -> MealOrder | None:
    result = await session.execute(
        select(MealOrder)
        .options(selectinload(MealOrder.items).selectinload(MealOrderItem.menu_item))
        .where(MealOrder.id == order_id)
    )
    return result.scalar_one_or_none()


async def list_meal_orders(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
    vendor_id: uuid.UUID | None = None,
    status: MealOrderStatus | None = None,
    limit: int = 30,
    offset: int = 0,
) -> list[MealOrder]:
    q = (
        select(MealOrder)
        .options(selectinload(MealOrder.items))
        .order_by(MealOrder.created_at.desc())
    )
    if user_id:
        q = q.where(MealOrder.user_id == user_id)
    if schedule_id:
        q = q.where(MealOrder.schedule_id == schedule_id)
    if vendor_id:
        q = q.where(MealOrder.vendor_id == vendor_id)
    if status:
        q = q.where(MealOrder.status == status)
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_meal_order(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    data: MealOrderCreate,
) -> MealOrder:
    """
    建立學餐訂單。
    驗證：
    1. 排程存在且未結單
    2. 結單截止時間未過
    3. 品項屬於該排程且可購買
    4. 同一學生對同一排程只能有一張訂單（DB UNIQUE 保護）
    """
    if data.pickup_slot_id is not None or any(item.availability_id for item in data.items):
        return await create_platform_meal_order(session, user_id=user_id, data=data)

    if data.schedule_id is None:
        raise ValueError("請指定菜單排程或取餐時段")
    schedule = await get_schedule(session, data.schedule_id)
    if schedule is None:
        raise ValueError("找不到此菜單排程")
    if schedule.is_closed:
        raise ValueError("此菜單排程已結單，無法訂購")
    now = datetime.now(UTC)
    if now > schedule.order_deadline:
        raise ValueError("已超過結單時間，無法訂購")
    if schedule.order_open_time and now < schedule.order_open_time:
        raise ValueError("訂餐尚未開放，請稍後再試")

    total_price = 0
    order_items: list[dict] = []

    for item_req in data.items:
        # B4: 使用 SELECT FOR UPDATE 鎖住品項列，防止並發超賣
        item_result = await session.execute(
            select(MenuItem).where(MenuItem.id == item_req.menu_item_id).with_for_update()
        )
        menu_item = item_result.scalar_one_or_none()
        if menu_item is None:
            raise ValueError(f"找不到品項 {item_req.menu_item_id}")
        if menu_item.schedule_id != schedule.id:
            raise ValueError(f"品項「{menu_item.name}」不屬於此排程")
        if not menu_item.is_available:
            raise ValueError(f"品項「{menu_item.name}」目前不提供")
        if menu_item.max_quantity is not None:
            # 在鎖定後計算已訂數量，確保不超賣
            from sqlalchemy import func

            ordered_result = await session.execute(
                select(func.coalesce(func.sum(MealOrderItem.quantity), 0))
                .join(MealOrder, MealOrderItem.order_id == MealOrder.id)
                .where(MealOrderItem.menu_item_id == menu_item.id)
                .where(MealOrder.status != MealOrderStatus.CANCELLED)
            )
            already_ordered: int = ordered_result.scalar_one()
            if already_ordered + item_req.quantity > menu_item.max_quantity:
                remaining = menu_item.max_quantity - already_ordered
                raise ValueError(f"品項「{menu_item.name}」數量不足（剩餘 {remaining} 份）")

        subtotal = menu_item.price * item_req.quantity
        total_price += subtotal
        order_items.append(
            {
                "menu_item": menu_item,
                "quantity": item_req.quantity,
                "unit_price": menu_item.price,
            }
        )

    serial = await generate_meal_serial(session)
    pickup_code = await generate_pickup_code(session)
    order = MealOrder(
        serial_number=serial,
        pickup_code=pickup_code,
        user_id=user_id,
        schedule_id=schedule.id,
        vendor_id=schedule.vendor_id,
        status=MealOrderStatus.PENDING,
        total_price=total_price,
        notes=data.notes,
    )
    session.add(order)
    await session.flush()

    for oi in order_items:
        session.add(
            MealOrderItem(
                order_id=order.id,
                menu_item_id=oi["menu_item"].id,
                quantity=oi["quantity"],
                unit_price=oi["unit_price"],
            )
        )
    await session.flush()
    logger.info("學餐訂單建立 serial=%s user=%s total=%d", serial, user_id, total_price)
    return order


async def create_platform_meal_order(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    data: MealOrderCreate,
) -> MealOrder:
    """建立平台式學餐訂單：商品上架 + 商品自訂取餐時段。"""
    if data.pickup_slot_id is None:
        raise ValueError("請選擇取餐時段")
    pickup_slot = await get_pickup_slot(session, data.pickup_slot_id)
    if pickup_slot is None or not pickup_slot.is_active:
        raise ValueError("找不到此取餐時段或時段已停用")
    availability = pickup_slot.availability
    if not availability.is_available:
        raise ValueError("此商品目前未開放訂購")
    now = datetime.now(UTC)
    if availability.sale_start and now < availability.sale_start:
        raise ValueError("此商品尚未開放訂購")
    if availability.sale_end and now > availability.sale_end:
        raise ValueError("此商品已截止訂購")
    if now > pickup_slot.order_deadline:
        raise ValueError("已超過此取餐時段的訂購截止時間")

    total_quantity = 0
    total_price = 0
    order_items: list[dict] = []
    for item_req in data.items:
        if item_req.availability_id != availability.id:
            raise ValueError("同一張訂單只能包含同一商品上架與同一取餐時段")
        total_quantity += item_req.quantity
        total_price += availability.price * item_req.quantity
        order_items.append(
            {
                "availability": availability,
                "quantity": item_req.quantity,
                "unit_price": availability.price,
                "product_name": availability.product.name if availability.product else None,
            }
        )

    if availability.max_quantity is not None:
        ordered = await session.scalar(
            select(func.coalesce(func.sum(MealOrderItem.quantity), 0))
            .join(MealOrder, MealOrderItem.order_id == MealOrder.id)
            .where(MealOrderItem.availability_id == availability.id)
            .where(MealOrder.status != MealOrderStatus.CANCELLED)
        )
        if int(ordered or 0) + total_quantity > availability.max_quantity:
            raise ValueError("此商品剩餘數量不足")
    if pickup_slot.capacity is not None:
        slot_ordered = await session.scalar(
            select(func.coalesce(func.sum(MealOrderItem.quantity), 0))
            .join(MealOrder, MealOrderItem.order_id == MealOrder.id)
            .where(MealOrder.pickup_slot_id == pickup_slot.id)
            .where(MealOrder.status != MealOrderStatus.CANCELLED)
        )
        if int(slot_ordered or 0) + total_quantity > pickup_slot.capacity:
            raise ValueError("此取餐時段容量已滿")

    from api.models.user import User

    user = await session.get(User, user_id)
    school_class = await class_svc.resolve_user_class(session, user) if user else None
    serial = await generate_meal_serial(session)
    pickup_code = await generate_pickup_code(session)
    order = MealOrder(
        serial_number=serial,
        pickup_code=pickup_code,
        user_id=user_id,
        schedule_id=None,
        vendor_id=availability.vendor_id,
        availability_id=availability.id,
        pickup_slot_id=pickup_slot.id,
        class_id=school_class.id if school_class else None,
        status=MealOrderStatus.PENDING,
        total_price=total_price,
        notes=data.notes,
    )
    session.add(order)
    await session.flush()
    for oi in order_items:
        session.add(
            MealOrderItem(
                order_id=order.id,
                menu_item_id=None,
                availability_id=oi["availability"].id,
                product_name_snapshot=oi["product_name"],
                quantity=oi["quantity"],
                unit_price=oi["unit_price"],
            )
        )
    await session.flush()
    return order


async def cancel_meal_order(
    session: AsyncSession,
    order: MealOrder,
    *,
    requested_by: uuid.UUID,
    reason: str | None = None,
) -> MealOrder:
    """取消訂單（結單前學生可自行取消）"""
    if order.user_id != requested_by:
        raise PermissionError("只有訂購人可取消訂單")
    if order.status == MealOrderStatus.CANCELLED:
        raise ValueError("訂單已取消")
    if order.status == MealOrderStatus.COMPLETED:
        raise ValueError("已完成的訂單無法取消")

    # 結單後不允許取消
    schedule = await session.get(MenuSchedule, order.schedule_id)
    if schedule and schedule.is_closed:
        raise ValueError("菜單已結單，無法取消訂單")

    order.status = MealOrderStatus.CANCELLED
    if reason:
        order.notes = f"[取消原因] {reason}" + (f"\n{order.notes}" if order.notes else "")
    await session.flush()
    logger.info("學餐訂單取消 serial=%s by=%s", order.serial_number, requested_by)
    return order


async def confirm_meal_order(session: AsyncSession, order: MealOrder) -> MealOrder:
    """商家確認訂單（PENDING → CONFIRMED）"""
    if order.status != MealOrderStatus.PENDING:
        raise ValueError(f"訂單狀態 {order.status.value} 無法確認")
    order.status = MealOrderStatus.CONFIRMED
    await session.flush()
    logger.info("學餐訂單確認 serial=%s", order.serial_number)
    return order


async def complete_meal_order(session: AsyncSession, order: MealOrder) -> MealOrder:
    """商家標記完成（CONFIRMED → COMPLETED）"""
    if order.status not in {MealOrderStatus.PENDING, MealOrderStatus.CONFIRMED}:
        raise ValueError(f"訂單狀態 {order.status.value} 無法標記完成")
    order.status = MealOrderStatus.COMPLETED
    order.pickup_status = MealPickupStatus.PICKED
    order.pickup_at = datetime.now(UTC)
    await session.flush()
    logger.info("學餐訂單完成 serial=%s", order.serial_number)
    return order


async def set_order_paid(
    session: AsyncSession, order: MealOrder, *, is_paid: bool, actor_id: uuid.UUID
) -> MealOrder:
    order.is_paid = is_paid
    if is_paid:
        order.paid_at = datetime.now(UTC)
        order.paid_by_id = actor_id
    else:
        order.paid_at = None
        order.paid_by_id = None
    await session.flush()
    return order


async def list_class_meal_orders(
    session: AsyncSession,
    *,
    class_ids: list[uuid.UUID],
    vendor_id: uuid.UUID | None = None,
    pickup_slot_id: uuid.UUID | None = None,
    is_paid: bool | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[MealOrder]:
    if not class_ids:
        return []
    q = select(MealOrder).where(MealOrder.class_id.in_(class_ids))
    if vendor_id:
        q = q.where(MealOrder.vendor_id == vendor_id)
    if pickup_slot_id:
        q = q.where(MealOrder.pickup_slot_id == pickup_slot_id)
    if is_paid is not None:
        q = q.where(MealOrder.is_paid.is_(is_paid))
    q = q.order_by(MealOrder.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def get_or_create_class_pickup_code(
    session: AsyncSession,
    *,
    class_id: uuid.UUID,
    vendor_id: uuid.UUID,
    pickup_slot_id: uuid.UUID,
    issued_to_id: uuid.UUID,
) -> dict:
    existing = await session.scalar(
        select(MealClassPickupCode).where(
            MealClassPickupCode.class_id == class_id,
            MealClassPickupCode.vendor_id == vendor_id,
            MealClassPickupCode.pickup_slot_id == pickup_slot_id,
        )
    )
    code = existing
    if code is None:
        pickup_slot = await get_pickup_slot(session, pickup_slot_id)
        expires_at = pickup_slot.pickup_end if pickup_slot else None
        code = MealClassPickupCode(
            code=await generate_class_pickup_code(session),
            class_id=class_id,
            vendor_id=vendor_id,
            pickup_slot_id=pickup_slot_id,
            issued_to_id=issued_to_id,
            expires_at=expires_at,
        )
        session.add(code)
        await session.flush()
    order_count = await session.scalar(
        select(func.count(MealOrder.id)).where(
            MealOrder.class_id == class_id,
            MealOrder.vendor_id == vendor_id,
            MealOrder.pickup_slot_id == pickup_slot_id,
            MealOrder.status != MealOrderStatus.CANCELLED,
        )
    )
    return {
        "code": code.code,
        "class_id": code.class_id,
        "vendor_id": code.vendor_id,
        "pickup_slot_id": code.pickup_slot_id,
        "expires_at": code.expires_at,
        "order_count": int(order_count or 0),
    }


async def lookup_and_redeem_pickup_code(
    session: AsyncSession, *, code: str, actor_id: uuid.UUID, redeem: bool = True
) -> dict:
    normalized = code.strip().upper()
    order = None
    if normalized.isdigit() and len(normalized) == 5:
        order = await get_order_by_pickup_code(session, normalized)
    if order is not None:
        completed = 0
        if redeem and order.status != MealOrderStatus.CANCELLED:
            await complete_meal_order(session, order)
            order.pickup_by_id = actor_id
            completed = 1
        return {
            "kind": "personal",
            "code": normalized,
            "matched_orders": 1,
            "completed_orders": completed,
            "total_price": order.total_price,
            "message": "已核銷個人取餐碼" if completed else "已查詢個人取餐碼",
        }

    class_code = await session.scalar(
        select(MealClassPickupCode).where(MealClassPickupCode.code == normalized)
    )
    if class_code is None:
        raise ValueError("找不到此取餐碼")
    if class_code.expires_at and class_code.expires_at < datetime.now(UTC):
        raise ValueError("此班級領取碼已過期")
    result = await session.execute(
        select(MealOrder).where(
            MealOrder.class_id == class_code.class_id,
            MealOrder.vendor_id == class_code.vendor_id,
            MealOrder.pickup_slot_id == class_code.pickup_slot_id,
            MealOrder.status != MealOrderStatus.CANCELLED,
        )
    )
    orders = list(result.scalars().all())
    completed = 0
    total = 0
    if redeem:
        now = datetime.now(UTC)
        for order in orders:
            total += order.total_price
            if order.status != MealOrderStatus.COMPLETED:
                order.status = MealOrderStatus.COMPLETED
                order.pickup_status = MealPickupStatus.CLASS_PICKED
                order.pickup_at = now
                order.pickup_by_id = actor_id
                completed += 1
        class_code.redeemed_at = now
        class_code.redeemed_by_id = actor_id
        await session.flush()
    else:
        total = sum(order.total_price for order in orders)
    return {
        "kind": "class",
        "code": normalized,
        "matched_orders": len(orders),
        "completed_orders": completed,
        "total_price": total,
        "message": "已批次核銷班級領取碼" if redeem else "已查詢班級領取碼",
    }


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


# ── 報表匯出 ──────────────────────────────────────────────────────────────────


async def _fetch_meal_order_rows(
    session: AsyncSession,
    vendor_id: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
) -> list[dict]:
    """聚合學餐訂單明細資料供 Pandas 處理"""
    from api.models.user import User

    q = (
        select(
            MealOrder.serial_number.label("訂單字號"),
            MealOrder.status.label("訂單狀態"),
            MealOrder.total_price.label("訂單總金額"),
            MealOrder.created_at.label("建立時間"),
            MealOrder.notes.label("備註"),
            User.display_name.label("訂購人"),
            User.student_id.label("學號"),
            MenuSchedule.date.label("服務日期"),
            MealVendor.name.label("商家名稱"),
            MenuItem.name.label("品項名稱"),
            MealOrderItem.product_name_snapshot.label("商品快照"),
            MealOrderItem.quantity.label("數量"),
            MealOrderItem.unit_price.label("單價"),
        )
        .join(MealOrderItem, MealOrder.id == MealOrderItem.order_id)
        .outerjoin(MenuItem, MealOrderItem.menu_item_id == MenuItem.id)
        .outerjoin(MenuSchedule, MealOrder.schedule_id == MenuSchedule.id)
        .join(MealVendor, MealOrder.vendor_id == MealVendor.id)
        .join(User, MealOrder.user_id == User.id)
        .order_by(MenuSchedule.date, MealOrder.created_at)
    )
    if vendor_id:
        q = q.where(MealOrder.vendor_id == vendor_id)
    if schedule_id:
        q = q.where(MealOrder.schedule_id == schedule_id)

    result = await session.execute(q)
    rows = result.mappings().all()
    return [
        {
            "服務日期": str(r["服務日期"] or ""),
            "商家名稱": r["商家名稱"],
            "訂單字號": r["訂單字號"],
            "訂購人": r["訂購人"],
            "學號": r["學號"] or "",
            "品項名稱": r["品項名稱"] or r["商品快照"] or "",
            "數量": r["數量"],
            "單價（NT$）": r["單價"],
            "小計（NT$）": r["數量"] * r["單價"],
            "訂單總金額（NT$）": r["訂單總金額"],
            "訂單狀態": r["訂單狀態"].value if hasattr(r["訂單狀態"], "value") else r["訂單狀態"],
            "備註": r["備註"] or "",
            "建立時間": r["建立時間"].strftime("%Y-%m-%d %H:%M:%S") if r["建立時間"] else "",
        }
        for r in rows
    ]


async def export_meal_orders_excel(
    session: AsyncSession,
    vendor_id: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
) -> bytes:
    """匯出學餐訂單報表 Excel（.xlsx）"""
    import pandas as pd

    rows = await _fetch_meal_order_rows(session, vendor_id=vendor_id, schedule_id=schedule_id)
    cols = [
        "服務日期",
        "商家名稱",
        "訂單字號",
        "訂購人",
        "學號",
        "品項名稱",
        "數量",
        "單價（NT$）",
        "小計（NT$）",
        "訂單總金額（NT$）",
        "訂單狀態",
        "備註",
        "建立時間",
    ]
    df = pd.DataFrame(rows) if rows else pd.DataFrame(columns=cols)

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="學餐訂單")
        ws = writer.sheets["學餐訂單"]
        for col in ws.columns:
            max_len = max((len(str(cell.value or "")) for cell in col), default=10)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 50)

    return buf.getvalue()


async def export_meal_orders_csv(
    session: AsyncSession,
    vendor_id: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
) -> str:
    """匯出學餐訂單報表 CSV（UTF-8 with BOM）"""
    import pandas as pd

    rows = await _fetch_meal_order_rows(session, vendor_id=vendor_id, schedule_id=schedule_id)
    df = pd.DataFrame(rows) if rows else pd.DataFrame()
    return df.to_csv(index=False, encoding="utf-8-sig")


# ── 熱門排序 / 核銷 ───────────────────────────────────────────────────────────


async def check_and_handle_no_shows(session: AsyncSession) -> dict:
    """
    未取餐處理（供 Celery Beat 每小時呼叫）：
    - Phase 1：結單後 1 小時，訂單仍為 confirmed 且未發提醒 → 寄信給使用者，設 reminder_sent_at
    - Phase 2：結單後 4 小時，訂單仍為 confirmed 且已發提醒 → 標記 is_no_show=True，寄信給管理員
    """
    from sqlalchemy.orm import selectinload as _sil

    from api.services.mail import enqueue_email

    now = datetime.now(UTC)
    reminder_threshold = now - __import__("datetime").timedelta(hours=1)
    no_show_threshold = now - __import__("datetime").timedelta(hours=4)

    # 找出所有 confirmed 且排程已結單的訂單
    q = (
        select(MealOrder)
        .options(
            _sil(MealOrder.user),
            _sil(MealOrder.schedule).selectinload(MenuSchedule.vendor),
        )
        .join(MenuSchedule, MealOrder.schedule_id == MenuSchedule.id)
        .where(MealOrder.status == MealOrderStatus.CONFIRMED)
        .where(MealOrder.is_no_show == False)  # noqa: E712
        .where(MenuSchedule.is_closed == True)  # noqa: E712
        .where(MenuSchedule.order_deadline <= reminder_threshold)
    )
    result = await session.execute(q)
    orders = result.scalars().all()

    reminded = 0
    marked_no_show = 0

    for order in orders:
        deadline = order.schedule.order_deadline
        user_email = order.user.email if order.user else None
        vendor_name = order.schedule.vendor.name if order.schedule.vendor else "商家"
        schedule_date = str(order.schedule.date)

        # Phase 2：已發提醒，且超過 4 小時 → 標記 no_show
        if order.reminder_sent_at is not None and deadline <= no_show_threshold:
            order.is_no_show = True
            marked_no_show += 1
            logger.info("標記未取餐 serial=%s user=%s", order.serial_number, order.user_id)
            # B6: 通知管理員（email 失敗不阻斷狀態更新）
            from api.core.config import settings

            if settings.MAIL_FROM:
                try:
                    enqueue_email(
                        to=settings.MAIL_FROM,
                        subject=f"[未取餐通知] {vendor_name} {schedule_date} 有訂單未取",
                        body=(
                            f"<p>以下訂單已超過 4 小時未取餐，已自動標記：</p>"
                            f"<ul>"
                            f"<li>代碼：<strong>{order.pickup_code}</strong></li>"
                            f"<li>字號：{order.serial_number}</li>"
                            f"<li>金額：NT${order.total_price}</li>"
                            f"<li>商家：{vendor_name}</li>"
                            f"<li>日期：{schedule_date}</li>"
                            f"</ul>"
                            f"<p>請至後台查閱並做後續處理。</p>"
                        ),
                    )
                except Exception as mail_err:
                    logger.warning(
                        "管理員通知 email 失敗 serial=%s err=%s", order.serial_number, mail_err
                    )

        # Phase 1：尚未發提醒 → 發提醒給使用者
        elif order.reminder_sent_at is None and user_email:
            order.reminder_sent_at = now
            reminded += 1
            logger.info("發送未取餐提醒 serial=%s email=%s", order.serial_number, user_email)
            try:
                enqueue_email(
                    to=user_email,
                    subject=f"[學餐提醒] 您在 {vendor_name} 的餐點尚未取",
                    body=(
                        f"<p>您好，</p>"
                        f"<p>您於 <strong>{schedule_date}</strong> 在 <strong>{vendor_name}</strong> "
                        f"的訂餐（代碼：<strong>{order.pickup_code}</strong>）尚未取餐。</p>"
                        f"<p>請盡快前往取餐，若超時未取將自動標記為未取餐並通知管理員。</p>"
                        f"<p>感謝您使用學餐系統。</p>"
                    ),
                )
            except Exception as mail_err:
                logger.warning("提醒 email 失敗 serial=%s err=%s", order.serial_number, mail_err)

    if reminded or marked_no_show:
        await session.flush()

    return {"reminded": reminded, "marked_no_show": marked_no_show}


async def assign_vendor_manager(
    session: AsyncSession,
    vendor: MealVendor,
    email: str,
) -> dict:
    """
    以 email 查找使用者，在商家所屬組織找或建立「學餐管理員」職位（含 meal:manage 權限），
    並將該使用者指派到此職位。
    回傳 {user_id, display_name, position_id, user_position_id}。
    """
    from sqlalchemy import and_

    from api.models.org import Permission, Position, UserPosition
    from api.models.user import User

    # 1. 查使用者
    user_result = await session.execute(select(User).where(User.email == email.lower().strip()))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise ValueError(f"找不到 email 為 {email} 的使用者")

    # 2. 在組織中找「學餐管理員」職位（或建立）
    pos_result = await session.execute(
        select(Position).where(
            and_(Position.org_id == vendor.org_id, Position.name == "學餐管理員")
        )
    )
    position = pos_result.scalar_one_or_none()

    if position is None:
        position = Position(
            name="學餐管理員",
            org_id=vendor.org_id,
        )
        session.add(position)
        await session.flush()
        # 加 meal:manage 權限
        session.add(Permission(position_id=position.id, code="meal:manage"))
        await session.flush()

    # 3. 指派使用者（避免重複）
    from datetime import date as date_type

    existing = await session.execute(
        select(UserPosition).where(
            and_(
                UserPosition.user_id == user.id,
                UserPosition.position_id == position.id,
                UserPosition.end_date.is_(None),
            )
        )
    )
    up = existing.scalar_one_or_none()
    if up is None:
        up = UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=date_type.today(),
        )
        session.add(up)
        await session.flush()
        logger.info("商家管理員指派 vendor=%s user=%s", vendor.id, user.id)
    manager = await session.scalar(
        select(MealVendorManager).where(
            MealVendorManager.vendor_id == vendor.id,
            MealVendorManager.user_id == user.id,
        )
    )
    if manager is None:
        manager = MealVendorManager(
            vendor_id=vendor.id,
            user_id=user.id,
            position_id=position.id,
            user_position_id=up.id,
            is_active=True,
        )
        session.add(manager)
    else:
        manager.is_active = True
        manager.position_id = position.id
        manager.user_position_id = up.id
    await session.flush()

    return {
        "user_id": str(user.id),
        "display_name": user.display_name,
        "email": user.email,
        "position_id": str(position.id),
        "user_position_id": str(up.id),
    }


async def get_schedule_item_stats(session: AsyncSession, schedule_id: uuid.UUID) -> list[dict]:
    """
    查詢某排程各品項的已訂數量（排除已取消訂單），供前端熱門排序使用。
    返回 list of {item_id, item_name, total_ordered}。
    """
    from sqlalchemy import func

    result = await session.execute(
        select(
            MealOrderItem.menu_item_id,
            MenuItem.name.label("item_name"),
            func.sum(MealOrderItem.quantity).label("total_ordered"),
        )
        .join(MenuItem, MealOrderItem.menu_item_id == MenuItem.id)
        .join(MealOrder, MealOrderItem.order_id == MealOrder.id)
        .where(MealOrder.schedule_id == schedule_id)
        .where(MealOrder.status != MealOrderStatus.CANCELLED)
        .group_by(MealOrderItem.menu_item_id, MenuItem.name)
    )
    return [
        {
            "item_id": str(r.menu_item_id),
            "item_name": r.item_name,
            "total_ordered": int(r.total_ordered),
        }
        for r in result
    ]


async def get_order_by_serial(session: AsyncSession, serial_number: str) -> MealOrder | None:
    """以訂單字號查詢訂單（含品項明細，供核銷用）"""
    result = await session.execute(
        select(MealOrder)
        .options(selectinload(MealOrder.items).selectinload(MealOrderItem.menu_item))
        .where(MealOrder.serial_number == serial_number.upper().strip())
    )
    return result.scalar_one_or_none()


async def get_order_by_pickup_code(session: AsyncSession, pickup_code: str) -> MealOrder | None:
    """以 5 位取餐代碼查詢訂單（含品項明細，供核銷掃描用）"""
    result = await session.execute(
        select(MealOrder)
        .options(selectinload(MealOrder.items).selectinload(MealOrderItem.menu_item))
        .where(MealOrder.pickup_code == pickup_code.strip())
    )
    return result.scalar_one_or_none()


async def get_schedule_pickup_list(session: AsyncSession, schedule_id: uuid.UUID) -> list[dict]:
    """
    取得排程的領餐名單（含訂購人姓名 / 學號 / 訂單狀態），用於核銷作業。
    排除已取消的訂單，依狀態（pending→confirmed→completed）+ 建立時間排序。
    """
    from api.models.user import User

    result = await session.execute(
        select(
            MealOrder.id,
            MealOrder.serial_number,
            MealOrder.pickup_code,
            MealOrder.status,
            MealOrder.total_price,
            MealOrder.notes,
            MealOrder.created_at,
            MealOrder.is_no_show,
            User.display_name,
            User.student_id,
        )
        .join(User, MealOrder.user_id == User.id)
        .where(MealOrder.schedule_id == schedule_id)
        .where(MealOrder.status != MealOrderStatus.CANCELLED)
        .order_by(MealOrder.status, MealOrder.created_at)
    )
    return [
        {
            "order_id": str(r.id),
            "serial_number": r.serial_number,
            "pickup_code": r.pickup_code,
            "status": r.status.value,
            "total_price": r.total_price,
            "notes": r.notes,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "is_no_show": r.is_no_show,
            "display_name": r.display_name,
            "student_id": r.student_id,
        }
        for r in result.mappings().all()
    ]
