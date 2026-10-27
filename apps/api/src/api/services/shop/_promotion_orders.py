"""優惠異動後，同步既有未收款登記單與應收款。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order, OrderStatus, ShopPromotion
from api.services import receivable as receivable_svc
from api.services.shop._orders import (
    _order_activity_id,
    _promotion_product_quantities,
    _promotion_product_subtotals,
    _sync_order_promotions,
    get_order,
)
from api.services.shop._promotions import (
    PromotionAllocation,
    _discount_amount,
    _promotion_issue,
    resolve_promotion,
)


async def lock_promotion_orders(
    session: AsyncSession, *, activity_ids: set[uuid.UUID | None]
) -> list[Order]:
    # 舊登記單可能尚未寫入 activity_id；載入品項後再核對實際活動。
    order_ids = await session.scalars(
        select(Order.id)
        .where(
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
            Order.is_paid.is_(False),
            Order.is_class_collected.is_(False),
            Order.test_product_id.is_(None),
            or_(Order.activity_id.in_(activity_ids - {None}), Order.activity_id.is_(None)),
        )
        .order_by(Order.created_at, Order.id)
        .with_for_update()
    )
    orders = []
    for order_id in order_ids.all():
        order = await get_order(session, order_id)
        if order is not None and _order_activity_id(order) in activity_ids:
            orders.append(order)
    return orders


async def _save_allocations(
    session: AsyncSession, order: Order, allocations: list[PromotionAllocation]
) -> None:
    await _sync_order_promotions(session, order, tuple(allocations))
    order.discount_amount = sum(row.discount_amount for row in allocations)
    order.total_price = max(0, order.subtotal_price - order.discount_amount)
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()


async def refresh_promotion_orders(
    session: AsyncSession, *, promotion: ShopPromotion, orders: list[Order]
) -> None:
    # 先釋放不再符合資格的名額，再依登記順序分配，避免先處理的新對象錯失限量優惠。
    now = datetime.now(UTC)
    for order in orders:
        current_ids = {row.promotion_id for row in order.applied_promotions}
        if order.promotion_id is not None:
            current_ids.add(order.promotion_id)
        if promotion.id not in current_ids:
            continue
        subtotals = _promotion_product_subtotals(order.items)
        quantities = _promotion_product_quantities(order.items)
        if (
            promotion.code is None
            and _promotion_issue(
                promotion,
                user_id=order.user_id,
                student_id=order.user.student_id,
                subtotal=order.subtotal_price,
                now=now,
                product_subtotals=subtotals,
                product_quantities=quantities,
                activity_id=_order_activity_id(order),
                current_promotion_ids=current_ids,
            )
            is None
            and _discount_amount(promotion, order.subtotal_price, subtotals, quantities) > 0
        ):
            continue
        await _save_allocations(
            session,
            order,
            [
                PromotionAllocation(row.promotion, row.discount_amount)
                for row in order.applied_promotions
                if row.promotion_id != promotion.id
            ],
        )

    for order in orders:
        previous = {row.promotion_id: row.discount_amount for row in order.applied_promotions}
        current_ids = set(previous)
        if order.promotion_id is not None:
            current_ids.add(order.promotion_id)
        # 自動優惠異動不撤銷使用者先前已兌換的優惠碼，即使該碼現在已過期。
        coupons = [
            PromotionAllocation(row.promotion, row.discount_amount)
            for row in order.applied_promotions
            if row.promotion.code
        ]
        if not previous and order.promotion_id is not None and order.promotion_code:
            coupon = await session.get(ShopPromotion, order.promotion_id)
            if coupon is not None:
                coupons.append(PromotionAllocation(coupon, order.discount_amount))

        automatic = await resolve_promotion(
            session,
            user_id=order.user_id,
            subtotal=order.subtotal_price,
            product_subtotals=_promotion_product_subtotals(order.items),
            product_quantities=_promotion_product_quantities(order.items),
            activity_id=_order_activity_id(order),
            current_promotion_ids=current_ids,
        )
        allocations = list(coupons)
        remaining = max(0, order.subtotal_price - sum(row.discount_amount for row in coupons))
        if automatic.promotion is not None and remaining > 0:
            allocations.append(
                PromotionAllocation(automatic.promotion, min(remaining, automatic.discount_amount))
            )
        selected = {row.promotion.id: row.discount_amount for row in allocations}
        if selected == previous:
            continue

        await _save_allocations(session, order, allocations)
