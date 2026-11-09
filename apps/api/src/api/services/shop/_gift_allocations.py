"""記錄實際贈品件數，讓明細分列時保留訂購數量與原價快照。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order, ShopDiscountType
from api.services.shop._promotion_topics import product_topic_ids, topic_totals

if TYPE_CHECKING:
    from api.services.shop._promotions import PromotionAllocation


async def snapshot_order_gifts(
    session: AsyncSession, order: Order, allocations: tuple[PromotionAllocation, ...]
) -> None:
    for item in order.items:
        item.gift_quantity = 0
        item.gift_discount_amount = 0
    gifts = [
        row
        for row in allocations
        if row.promotion.discount_type == ShopDiscountType.PERCENTAGE
        and row.promotion.discount_value == 100
        and row.promotion.target_products
    ]
    if not gifts:
        return
    amounts = {}
    quantities = {}
    for item in order.items:
        amounts[item.product_id] = amounts.get(item.product_id, 0) + item.quantity * item.unit_price
        quantities[item.product_id] = quantities.get(item.product_id, 0) + item.quantity
    categories = (
        await product_topic_ids(session, set(amounts))
        if any(row.promotion.target_category_ids is not None for row in gifts)
        else {}
    )
    # UUID 順序固定跨重新載入的分配；各規格／本人與代訂品項共用每項商品的贈送額度。
    items = sorted(order.items, key=lambda item: str(item.id))
    for allocation in gifts:
        promotion = allocation.promotion
        eligible = set(amounts)
        if promotion.target_category_ids is not None:
            eligible = {
                product_id
                for total in topic_totals(promotion, amounts, quantities, categories)
                if total.subtotal >= promotion.min_order_price
                and sum(total.quantities.values()) >= promotion.min_quantity
                for product_id in total.amounts
            }
        budget = allocation.discount_amount
        for product in sorted(promotion.target_products, key=lambda product: str(product.id)):
            if product.id not in eligible:
                continue
            remaining = promotion.gift_quantity
            for item in items:
                if item.product_id != product.id:
                    continue
                unit_discount = min(product.price, item.unit_price)
                if unit_discount <= 0:
                    continue
                count = min(
                    remaining,
                    item.quantity - item.gift_quantity,
                    budget // unit_discount,
                )
                item.gift_quantity += count
                item.gift_discount_amount += count * unit_discount
                remaining -= count
                budget -= count * unit_discount
