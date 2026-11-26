"""優惠異動後，同步既有未收款登記單與應收款。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order, OrderStatus, ShopPromotion
from api.services import receivable as receivable_svc
from api.services.shop._gift_allocations import snapshot_order_gifts
from api.services.shop._orders import (
    _order_detail_query,
    _promotion_product_quantities,
    _promotion_product_subtotals,
    _sync_order_promotions,
)
from api.services.shop._promotion_topics import product_topic_ids
from api.services.shop._promotions import (
    PromotionAllocation,
    PromotionResult,
    _allocate_promotions,
    _automatic_promotion_results,
    _discount_amount,
    _promotion_issue,
)


async def lock_promotion_orders(session: AsyncSession) -> list[Order]:
    orders = await session.scalars(
        _order_detail_query()
        .where(
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
            Order.is_paid.is_(False),
            Order.is_class_collected.is_(False),
            Order.test_product_id.is_(None),
        )
        .order_by(Order.created_at, Order.id)
        .with_for_update()
    )
    return list(orders.all())


async def _save_allocations(
    session: AsyncSession, order: Order, allocations: list[PromotionAllocation]
) -> None:
    await _sync_order_promotions(session, order, tuple(allocations))
    order.discount_amount = sum(row.discount_amount for row in allocations)
    order.total_price = max(0, order.subtotal_price - order.discount_amount)
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()


async def _reprice_order(
    session: AsyncSession,
    order: Order,
    *,
    automatic_promotions: list[ShopPromotion],
    categories: dict[uuid.UUID, uuid.UUID | None],
    now: datetime,
) -> bool:
    """依目前有效優惠重新擇優並寫回訂單；回傳折抵是否有變動。"""
    previous = {row.promotion_id: row.discount_amount for row in order.applied_promotions}
    current_ids = set(previous)
    if order.promotion_id is not None:
        current_ids.add(order.promotion_id)
    # 保留先前兌換的優惠碼（含過期碼），但與套組重複的商品仍須排除。
    coupons = [
        PromotionAllocation(row.promotion, row.discount_amount)
        for row in order.applied_promotions
        if row.promotion.code
    ]
    if not previous and order.promotion_id is not None and order.promotion_code:
        coupon = await session.get(ShopPromotion, order.promotion_id)
        if coupon is not None:
            coupons.append(PromotionAllocation(coupon, order.discount_amount))

    subtotals = _promotion_product_subtotals(order.items)
    quantities = _promotion_product_quantities(order.items)
    # 優惠碼折抵額依目前品項重算，不沿用舊快照。
    coupons = [
        PromotionAllocation(
            row.promotion,
            _discount_amount(
                row.promotion, order.subtotal_price, subtotals, quantities, categories
            ),
        )
        for row in coupons
    ]
    allocations = list(
        _allocate_promotions(
            [
                *[PromotionResult(row.promotion, row.discount_amount) for row in coupons],
                *_automatic_promotion_results(
                    automatic_promotions,
                    user_id=order.user_id,
                    student_id=order.user.student_id if order.user else None,
                    subtotal=order.subtotal_price,
                    now=now,
                    categories=categories,
                    product_subtotals=subtotals,
                    product_quantities=quantities,
                    current_ids=current_ids,
                ),
            ],
            order.subtotal_price,
            product_subtotals=subtotals,
            product_quantities=quantities,
            product_category_ids=categories,
        )
    )
    selected = {row.promotion.id: row.discount_amount for row in allocations}
    discount = sum(selected.values())
    totals_match = order.discount_amount == discount and order.total_price == max(
        0, order.subtotal_price - discount
    )
    if selected == previous and totals_match:
        await snapshot_order_gifts(
            session, order, tuple(allocations), product_category_ids=categories
        )
        return False

    await _save_allocations(session, order, allocations)
    return True


async def refresh_promotion_orders(
    session: AsyncSession, *, promotion: ShopPromotion, orders: list[Order]
) -> None:
    if not orders:
        return
    # 先釋放不再符合資格的名額，再依登記順序分配，避免先處理的新對象錯失限量優惠。
    categories = await product_topic_ids(
        session, {item.product_id for order in orders for item in order.items}
    )
    now = datetime.now(UTC)
    automatic_promotions = list(
        await session.scalars(
            select(ShopPromotion)
            .where(
                ShopPromotion.code.is_(None),
                ShopPromotion.is_active.is_(True),
            )
            .order_by(ShopPromotion.id)
            .with_for_update()
        )
    )
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
                student_id=order.user.student_id if order.user else None,
                subtotal=order.subtotal_price,
                now=now,
                product_category_ids=categories,
                product_subtotals=subtotals,
                product_quantities=quantities,
                current_promotion_ids=current_ids,
            )
            is None
            and _discount_amount(promotion, order.subtotal_price, subtotals, quantities, categories)
            > 0
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
        await _reprice_order(
            session,
            order,
            automatic_promotions=automatic_promotions,
            categories=categories,
            now=now,
        )


@dataclass(frozen=True)
class OrderRecalculation:
    order_id: uuid.UUID
    serial_number: str
    status: str  # updated / unchanged / skipped
    reason: str | None
    old_total: int
    new_total: int


async def recalculate_orders(
    session: AsyncSession, order_ids: list[uuid.UUID]
) -> list[OrderRecalculation]:
    """手動重算指定訂單的優惠；已收款、已結束或班級已代收的訂單略過。"""
    unique_ids = list(dict.fromkeys(order_ids))
    orders = list(
        await session.scalars(
            _order_detail_query()
            .where(Order.id.in_(unique_ids))
            .order_by(Order.created_at, Order.id)
            .with_for_update()
        )
    )
    found = {order.id for order in orders}
    results = [
        OrderRecalculation(order_id, "", "skipped", "找不到此訂單", 0, 0)
        for order_id in unique_ids
        if order_id not in found
    ]
    eligible: list[Order] = []
    for order in orders:
        reason = None
        if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
            reason = "訂單已取消、退款或完成，無法重算"
        elif order.test_product_id is not None:
            reason = "測試訂單不重算"
        elif order.is_paid:
            reason = "訂單已收款，請先處理收款再重算"
        elif order.is_class_collected:
            reason = "班級已代收款，請先取消代收再重算"
        if reason:
            results.append(
                OrderRecalculation(
                    order.id,
                    order.serial_number,
                    "skipped",
                    reason,
                    order.total_price,
                    order.total_price,
                )
            )
        else:
            eligible.append(order)
    if eligible:
        categories = await product_topic_ids(
            session, {item.product_id for order in eligible for item in order.items}
        )
        now = datetime.now(UTC)
        automatic_promotions = list(
            await session.scalars(
                select(ShopPromotion)
                .where(
                    ShopPromotion.code.is_(None),
                    ShopPromotion.is_active.is_(True),
                )
                .order_by(ShopPromotion.id)
                .with_for_update()
            )
        )
        for order in eligible:
            old_total = order.total_price
            changed = await _reprice_order(
                session,
                order,
                automatic_promotions=automatic_promotions,
                categories=categories,
                now=now,
            )
            results.append(
                OrderRecalculation(
                    order.id,
                    order.serial_number,
                    "updated" if changed else "unchanged",
                    None,
                    old_total,
                    order.total_price,
                )
            )
    return results
