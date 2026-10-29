"""班級繳款後的獨立補收款與收據。"""

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderStatus
from api.services import receivable as receivable_svc
from api.services.shop._orders import _lock_class_orders, get_order
from api.services.shop._receipts import _render_class_receipt_pdf


async def list_supplements(
    session: AsyncSession, *, actor_id: uuid.UUID | None, limit: int, offset: int
) -> list[Order]:
    query = select(Order.id).where(
        Order.supplement_class_id.is_not(None),
        Order.status.notin_((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
    )
    if actor_id is not None:
        query = query.where(Order.assisted_by_id == actor_id)
    ids = await session.scalars(
        query.order_by(Order.is_paid, Order.created_at.desc(), Order.id).limit(limit).offset(offset)
    )
    orders = []
    for order_id in ids:
        order = await get_order(session, order_id)
        if order is not None:
            orders.append(order)
    return orders


async def export_supplement_receipt(session: AsyncSession, order: Order) -> bytes:
    if order.supplement_class_id is None or not order.is_paid:
        raise ValueError("補收款確認繳費後才能下載收據")
    if order.status in (OrderStatus.CANCELLED, OrderStatus.REFUNDED):
        raise ValueError("已取消或退款的訂單無法下載收據")
    school_class = await session.get(SchoolClass, order.supplement_class_id)
    if school_class is None:
        raise ValueError("找不到原班級")
    return await asyncio.to_thread(
        _render_class_receipt_pdf,
        f"{school_class.label or school_class.class_code} {order.user.display_name} 補收款",
        school_class.academic_year,
        f"{order.activity.name if order.activity else '一般商品'} · {order.serial_number}",
        [order],
        local_today(),
    )


async def separate_order(session: AsyncSession, order: Order, *, actor_id: uuid.UUID) -> Order:
    original_class_id = order.supplement_class_id or order.class_id
    if original_class_id is None or order.test_product_id is not None:
        raise ValueError("此訂單無法分出班級收款")
    await _lock_class_orders(session, original_class_id)
    await session.execute(
        select(Order)
        .where(Order.id == order.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if order.is_paid:
        raise ValueError("已繳費訂單請先撤銷繳費，再獨立收款")
    if order.status in (OrderStatus.CANCELLED, OrderStatus.REFUNDED):
        raise ValueError("已取消或退款的訂單無法獨立收款")
    if order.supplement_class_id is None:
        order.supplement_class_id = original_class_id
        order.assisted_by_id = actor_id
        order.assistance_scope = "supplement"
    order.class_id = None
    order.school_class = None
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    return await get_order(session, order.id) or order
