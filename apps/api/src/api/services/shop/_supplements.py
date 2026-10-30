"""班級繳款後的獨立補收款與收據。"""

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import now_local
from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderStatus
from api.services import receivable as receivable_svc
from api.services.shop._orders import _lock_class_orders, _order_detail_query, get_order
from api.services.shop._payment_notifications import queue_individual_payment_notice
from api.services.shop._receipts import (
    record_order_receipts_printed,
    render_individual_order_receipt,
)


async def list_supplements(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID | None,
    class_ids: set[uuid.UUID] | None = None,
    limit: int,
    offset: int,
) -> list[Order]:
    query = _order_detail_query().where(
        Order.supplement_class_id.is_not(None),
        Order.status.notin_((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
    )
    if actor_id is not None:
        scopes = [Order.assisted_by_id == actor_id]
        if class_ids:
            scopes.append(Order.supplement_class_id.in_(class_ids))
        query = query.where(or_(*scopes))
    orders = await session.scalars(
        query.order_by(Order.is_paid, Order.created_at.desc(), Order.id).limit(limit).offset(offset)
    )
    return list(orders.all())


async def export_supplement_receipt(session: AsyncSession, order: Order) -> bytes:
    if order.supplement_class_id is None:
        raise ValueError("此訂單不是獨立補收款")
    if order.status in (OrderStatus.CANCELLED, OrderStatus.REFUNDED):
        raise ValueError("已取消或退款的訂單無法下載收據")
    if await session.get(SchoolClass, order.supplement_class_id) is None:
        raise ValueError("找不到原班級")
    printed_at = now_local()
    receipt = await render_individual_order_receipt(session, order, printed_at=printed_at)
    await record_order_receipts_printed(
        session,
        [order.id],
        printed_at=printed_at,
    )
    return receipt


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
    was_in_class = order.class_id is not None
    if order.supplement_class_id is None:
        order.supplement_class_id = original_class_id
        order.assisted_by_id = actor_id
        order.assistance_scope = "supplement"
    order.class_id = None
    order.school_class = None
    receivable = await receivable_svc.sync_shop_order(session, order)
    if was_in_class:
        await queue_individual_payment_notice(
            session,
            order,
            reason="separated_from_class",
            due_at=receivable.due_at if receivable else None,
        )
    await session.flush()
    return await get_order(session, order.id) or order


async def rejoin_class_order(session: AsyncSession, order: Order) -> Order:
    """將未繳費的補收訂單歸回原班，保留班代的收款紀錄。"""
    class_id = order.supplement_class_id
    if class_id is None:
        raise ValueError("此訂單不是獨立補收款")
    await _lock_class_orders(session, class_id)
    await session.execute(
        select(Order)
        .where(Order.id == order.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    refreshed = await get_order(session, order.id)
    if refreshed is None or refreshed.supplement_class_id is None:
        raise ValueError("此訂單已不在補收款清單")
    if refreshed.is_paid:
        raise ValueError("已繳費訂單已歸回原班")
    if refreshed.status in (OrderStatus.CANCELLED, OrderStatus.REFUNDED):
        raise ValueError("已取消或退款的訂單無法歸回班級")
    school_class = await session.get(SchoolClass, refreshed.supplement_class_id)
    if school_class is None:
        raise ValueError("找不到原班級")
    refreshed.class_id = school_class.id
    refreshed.school_class = school_class
    refreshed.supplement_class_id = None
    await receivable_svc.sync_shop_order(session, refreshed)
    await session.flush()
    return await get_order(session, refreshed.id) or refreshed
