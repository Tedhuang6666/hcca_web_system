"""訂單 CRUD / 班級訂購 / 核銷"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.meal import (
    MealClassPickupCode,
    MealOrder,
    MealOrderItem,
    MealOrderStatus,
    MealPickupSlot,
    MealPickupStatus,
    MealProductAvailability,
    MenuItem,
    MenuSchedule,
)
from api.schemas.meal import MealOrderCreate
from api.services import receivable as receivable_svc
from api.services import school_class as class_svc
from api.services.meal._schedule import get_schedule
from api.services.meal._vendor import (
    generate_class_pickup_code,
    generate_meal_serial,
    generate_pickup_code,
    get_pickup_slot,
)

logger = logging.getLogger(__name__)


# ── 內部驗證工具 ──────────────────────────────────────────────────────────────


async def _validate_and_lock_menu_item(
    session: AsyncSession,
    *,
    item_req,
    schedule: MenuSchedule,
) -> MenuItem:
    """FOR UPDATE 鎖住品項列，驗證合法性與庫存，回傳 MenuItem。"""
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
    return menu_item


async def _check_platform_capacity(
    session: AsyncSession,
    *,
    availability: MealProductAvailability,
    pickup_slot: MealPickupSlot,
    total_quantity: int,
) -> None:
    """驗證商品上架庫存與取餐時段容量，超賣則拋出 ValueError。"""
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


# ── 訂單查詢 ──────────────────────────────────────────────────────────────────


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


# ── 訂單建立 ──────────────────────────────────────────────────────────────────


async def create_meal_order(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    data: MealOrderCreate,
    assistance_scope: str = "self",
    assisted_by_id: uuid.UUID | None = None,
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
        return await create_platform_meal_order(
            session,
            user_id=user_id,
            data=data,
            assistance_scope=assistance_scope,
            assisted_by_id=assisted_by_id,
        )

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
        menu_item = await _validate_and_lock_menu_item(session, item_req=item_req, schedule=schedule)
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
    from api.models.user import User

    user = await session.get(User, user_id)
    school_class = await class_svc.resolve_user_class(session, user) if user else None
    order = MealOrder(
        serial_number=serial,
        pickup_code=pickup_code,
        user_id=user_id,
        schedule_id=schedule.id,
        vendor_id=schedule.vendor_id,
        class_id=school_class.id if school_class else None,
        assistance_scope=assistance_scope,
        assisted_by_id=assisted_by_id,
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
    await receivable_svc.sync_meal_order(session, order)
    return order


async def create_platform_meal_order(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    data: MealOrderCreate,
    assistance_scope: str = "self",
    assisted_by_id: uuid.UUID | None = None,
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

    # 鎖住商品上架列，序列化同一商品的並發訂購，避免 max_quantity / 取餐時段容量超賣
    await session.execute(
        select(MealProductAvailability.id)
        .where(MealProductAvailability.id == availability.id)
        .with_for_update()
    )

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

    await _check_platform_capacity(
        session, availability=availability, pickup_slot=pickup_slot, total_quantity=total_quantity
    )

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
        assistance_scope=assistance_scope,
        assisted_by_id=assisted_by_id,
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
    await receivable_svc.sync_meal_order(session, order)
    return order


# ── 訂單操作 ──────────────────────────────────────────────────────────────────


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

    schedule = await session.get(MenuSchedule, order.schedule_id)
    if schedule and schedule.is_closed:
        raise ValueError("菜單已結單，無法取消訂單")

    order.status = MealOrderStatus.CANCELLED
    if reason:
        order.notes = f"[取消原因] {reason}" + (f"\n{order.notes}" if order.notes else "")
    await receivable_svc.cancel_for_source(session, "meal_order", order.id)
    await session.flush()
    logger.info("學餐訂單取消 serial=%s by=%s", order.serial_number, requested_by)
    return order


async def replace_meal_order_items(
    session: AsyncSession,
    order: MealOrder,
    *,
    data: MealOrderCreate,
) -> MealOrder:
    if order.status in {MealOrderStatus.CANCELLED, MealOrderStatus.COMPLETED}:
        raise ValueError(f"訂單狀態 {order.status.value} 無法修改")

    for item in list(order.items):
        await session.delete(item)
    await session.flush()

    total_price = 0
    order_items: list[MealOrderItem] = []
    now = datetime.now(UTC)

    if data.pickup_slot_id is not None or any(item.availability_id for item in data.items):
        if data.pickup_slot_id is None:
            raise ValueError("請選擇取餐時段")
        pickup_slot = await get_pickup_slot(session, data.pickup_slot_id)
        if pickup_slot is None or not pickup_slot.is_active:
            raise ValueError("找不到此取餐時段或時段已停用")
        availability = pickup_slot.availability
        if not availability.is_available:
            raise ValueError("此商品目前未開放訂購")
        if availability.sale_start and now < availability.sale_start:
            raise ValueError("此商品尚未開放訂購")
        if availability.sale_end and now > availability.sale_end:
            raise ValueError("此商品已截止訂購")
        if now > pickup_slot.order_deadline:
            raise ValueError("已超過此取餐時段的訂購截止時間")

        # 鎖住商品上架列，序列化並發修改/訂購，避免容量超賣（同 create_platform_meal_order）。
        await session.execute(
            select(MealProductAvailability.id)
            .where(MealProductAvailability.id == availability.id)
            .with_for_update()
        )

        total_quantity = 0
        for item_req in data.items:
            if item_req.availability_id != availability.id:
                raise ValueError("同一張訂單只能包含同一商品上架與同一取餐時段")
            total_quantity += item_req.quantity
            total_price += availability.price * item_req.quantity
            order_items.append(
                MealOrderItem(
                    order_id=order.id,
                    menu_item_id=None,
                    availability_id=availability.id,
                    product_name_snapshot=availability.product.name
                    if availability.product
                    else None,
                    quantity=item_req.quantity,
                    unit_price=availability.price,
                )
            )

        await _check_platform_capacity(
            session,
            availability=availability,
            pickup_slot=pickup_slot,
            total_quantity=total_quantity,
        )

        order.schedule_id = None
        order.vendor_id = availability.vendor_id
        order.availability_id = availability.id
        order.pickup_slot_id = pickup_slot.id
    else:
        if data.schedule_id is None:
            raise ValueError("請指定菜單排程或取餐時段")
        schedule = await get_schedule(session, data.schedule_id)
        if schedule is None:
            raise ValueError("找不到此菜單排程")
        if schedule.is_closed or now > schedule.order_deadline:
            raise ValueError("此菜單排程已結單，無法修改")
        if schedule.order_open_time and now < schedule.order_open_time:
            raise ValueError("訂餐尚未開放，請稍後再試")

        for item_req in data.items:
            menu_item = await _validate_and_lock_menu_item(
                session, item_req=item_req, schedule=schedule
            )
            total_price += menu_item.price * item_req.quantity
            order_items.append(
                MealOrderItem(
                    order_id=order.id,
                    menu_item_id=menu_item.id,
                    quantity=item_req.quantity,
                    unit_price=menu_item.price,
                )
            )
        order.schedule_id = schedule.id
        order.vendor_id = schedule.vendor_id
        order.availability_id = None
        order.pickup_slot_id = None

    order.total_price = total_price
    order.notes = data.notes
    session.add_all(order_items)
    await receivable_svc.sync_meal_order(session, order)
    await session.flush()
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
    await receivable_svc.sync_meal_order(session, order)
    await session.flush()
    return order


# ── 班級訂購 ──────────────────────────────────────────────────────────────────


async def list_class_meal_orders(
    session: AsyncSession,
    *,
    class_ids: list[uuid.UUID],
    vendor_id: uuid.UUID | None = None,
    pickup_slot_id: uuid.UUID | None = None,
    is_paid: bool | None = None,
    assistance_scope: str | None = None,
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
    if assistance_scope:
        q = q.where(MealOrder.assistance_scope == assistance_scope)
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
            MealOrder.assistance_scope == "class_assisted",
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
            MealOrder.assistance_scope == "class_assisted",
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
