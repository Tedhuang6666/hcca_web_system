"""目前登記與班級成員訂購查詢。"""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order, OrderItem, OrderStatus
from api.models.user import User
from api.services import receivable as receivable_svc
from api.services import school_class as class_svc
from api.services.shop._orders import (
    _apply_order_promotion,
    _assert_activity_order_unlocked,
    _assert_product_registration_open,
    _lock_class_orders,
    _order_activity_id,
    _order_detail_query,
    _product_category_filter,
    get_order,
)


async def get_current_registration(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    activity_id: uuid.UUID | None = None,
    match_activity: bool = False,
    category_id: uuid.UUID | None = None,
    lock: bool = False,
    reuse_cancelled: bool = False,
    test_product_id: uuid.UUID | None = None,
    editable_only: bool = False,
) -> Order | None:
    statuses = [OrderStatus.PENDING, OrderStatus.CONFIRMED]
    if reuse_cancelled:
        statuses.append(OrderStatus.CANCELLED)
    query = select(Order).where(
        Order.user_id == user_id,
        Order.status.in_(statuses),
        Order.test_product_id == test_product_id,
        Order.supplement_class_id.is_(None),
        Order.assistance_scope != "council_gift",
    )
    if editable_only:
        query = query.where(
            Order.is_paid.is_(False),
            Order.is_class_collected.is_(False),
            Order.is_class_balance.is_(False),
            Order.received_amount == 0,
        )
    if match_activity:
        query = query.where(
            Order.activity_id.is_(None) if activity_id is None else Order.activity_id == activity_id
        )
    if match_activity and activity_id is None and category_id is not None:
        query = query.where(
            or_(
                Order.category_id == category_id,
                Order.category_id.is_(None)
                & Order.items.any(OrderItem.product.has(_product_category_filter(category_id))),
            )
        )
    query = query.order_by(
        (Order.status == OrderStatus.CANCELLED), Order.updated_at.desc(), Order.created_at.desc()
    ).limit(1)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    result = await session.execute(query)
    order = result.scalars().first()
    return await get_order(session, order.id) if order else None


async def get_current_registrations(
    session: AsyncSession, user_id: uuid.UUID, *, include_testing: bool = False
) -> list[Order]:
    result = await session.execute(
        _order_detail_query()
        .where(
            Order.user_id == user_id,
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
            Order.supplement_class_id.is_(None),
            Order.assistance_scope != "council_gift",
            True if include_testing else Order.test_product_id.is_(None),
        )
        .order_by(Order.created_at.desc(), Order.updated_at.desc())
    )
    return list(result.scalars().all())


async def _get_class_member_orders(
    session: AsyncSession,
    user_id: uuid.UUID,
    class_ids: list[uuid.UUID],
    *,
    lock: bool = False,
) -> list[Order]:
    query = (
        _order_detail_query()
        .where(
            Order.user_id == user_id,
            Order.test_product_id.is_(None),
            or_(Order.supplement_class_id.is_(None), Order.class_id.is_not(None)),
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
            or_(Order.class_id.in_(class_ids), Order.class_id.is_(None)),
        )
        .order_by(Order.created_at.desc(), Order.updated_at.desc())
    )
    if lock:
        query = query.with_for_update()
    result = await session.execute(query)
    return list(result.scalars().all())


async def get_class_member_registrations(
    session: AsyncSession,
    user_id: uuid.UUID,
    class_ids: list[uuid.UUID],
) -> list[Order]:
    """取得班代有權管理的學生所有有效訂購。"""
    return await _get_class_member_orders(session, user_id, class_ids)


async def apply_registration_promotion(
    session: AsyncSession,
    user: User,
    *,
    code: str | None,
    activity_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
) -> Order:
    school_class = await class_svc.resolve_user_class(session, user)
    await _lock_class_orders(session, school_class.id if school_class else None)
    order = await get_current_registration(
        session,
        user.id,
        activity_id=activity_id,
        category_id=category_id,
        match_activity=True,
        lock=True,
        editable_only=True,
    )
    if order is None or not order.items:
        raise ValueError("請先登記商品，再套用優惠")
    if (
        order.is_paid
        or order.is_class_collected
        or order.is_class_balance
        or order.received_amount > 0
    ):
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")
    if category_id is not None and order.category_id != category_id:
        raise ValueError("這筆舊訂單包含多個活動，請聯繫班級幹部處理")
    await _assert_activity_order_unlocked(session, _order_activity_id(order))
    for item in order.items:
        await _assert_product_registration_open(
            session, item.product, class_id=order.class_id, allow_sold_out=True
        )
    await _apply_order_promotion(session, order, code=code)
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    return order
