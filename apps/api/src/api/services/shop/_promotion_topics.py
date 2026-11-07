"""商品主題優惠：每個主題分別判斷門檻與折抵，不合併不同主題的消費。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Product, ProductCategory, ProductSeries, ShopDiscountType, ShopPromotion


async def product_topic_ids(
    session: AsyncSession, product_ids: set[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID | None]:
    if not product_ids:
        return {}
    rows = await session.execute(
        select(Product.id, func.coalesce(Product.category_id, ProductSeries.category_id))
        .outerjoin(ProductSeries, Product.series_id == ProductSeries.id)
        .where(Product.id.in_(product_ids))
    )
    return {product_id: category_id for product_id, category_id in rows}


async def validate_topic_scope(
    session: AsyncSession, category_ids: list[uuid.UUID], products: list[Product]
) -> list[str]:
    unique_ids = list(dict.fromkeys(category_ids))
    if unique_ids:
        found = set(
            await session.scalars(
                select(ProductCategory.id).where(ProductCategory.id.in_(unique_ids))
            )
        )
        if found != set(unique_ids):
            raise ValueError("找不到指定商品主題")
        categories = await product_topic_ids(session, {product.id for product in products})
        if any(category_id not in found for category_id in categories.values()):
            raise ValueError(
                "適用商品必須屬於已選擇的商品主題；跨主題設定請加入其他主題或取消主題限制"
            )
    return [str(category_id) for category_id in unique_ids]


@dataclass(frozen=True)
class TopicTotals:
    subtotal: int
    amounts: dict[uuid.UUID, int]
    quantities: dict[uuid.UUID, int]


def topic_totals(
    promotion: ShopPromotion,
    amounts: dict[uuid.UUID, int] | None,
    quantities: dict[uuid.UUID, int] | None,
    categories: dict[uuid.UUID, uuid.UUID | None] | None,
) -> list[TopicTotals]:
    allowed = set(promotion.target_category_ids or [])
    targets = {product.id for product in promotion.target_products}
    grouped: dict[uuid.UUID | None, dict[uuid.UUID, int]] = {}
    for product_id, amount in (amounts or {}).items():
        # 缺少商品資料時不把未知主題湊在一起。
        if product_id not in (categories or {}):
            continue
        category_id = (categories or {})[product_id]
        if allowed and str(category_id) not in allowed:
            continue
        grouped.setdefault(category_id, {})[product_id] = amount
    result = []
    for group in grouped.values():
        eligible = {key: value for key, value in group.items() if not targets or key in targets}
        if eligible:
            result.append(
                TopicTotals(
                    subtotal=sum(group.values()),
                    amounts=eligible,
                    quantities={key: (quantities or {}).get(key, 0) for key in eligible},
                )
            )
    return result


def topic_issue(
    promotion: ShopPromotion, totals: list[TopicTotals], selected_ids: set[uuid.UUID]
) -> tuple[str, str, int, int] | None:
    targets = {product.id for product in promotion.target_products}
    if promotion.discount_type != ShopDiscountType.PRICE_OVERRIDE and not targets.issubset(
        selected_ids
    ):
        return "items_not_matched", "需同時登記指定商品才能使用此優惠。", 0, 0
    if not totals:
        return "items_not_matched", "此優惠限適用主題內的指定商品使用。", 0, 0
    issues = []
    for total in totals:
        shortfall = max(0, promotion.min_order_price - total.subtotal)
        quantity_shortfall = max(0, promotion.min_quantity - sum(total.quantities.values()))
        if not shortfall and not quantity_shortfall:
            return None
        if shortfall:
            issues.append(
                (
                    "minimum_not_met",
                    f"各商品主題分開計算；單一主題還差 NT${shortfall:,}，消費滿 NT${promotion.min_order_price:,} 即可使用。",
                    shortfall,
                    quantity_shortfall,
                )
            )
        else:
            issues.append(
                (
                    "quantity_not_met",
                    f"各商品主題分開計算；單一主題再登記 {quantity_shortfall} 件即可達到 {promotion.min_quantity} 件優惠門檻。",
                    0,
                    quantity_shortfall,
                )
            )
    return min(issues, key=lambda row: (row[2], row[3]))


def topic_discount_amount(promotion: ShopPromotion, totals: list[TopicTotals]) -> int:
    products = {product.id: product for product in promotion.target_products}
    qualifying = [
        total
        for total in totals
        if total.subtotal >= promotion.min_order_price
        and sum(total.quantities.values()) >= promotion.min_quantity
    ]
    if promotion.discount_type == ShopDiscountType.BUNDLE_PRICE:
        quantities = {key: value for total in qualifying for key, value in total.quantities.items()}
        count = min((quantities.get(key, 0) for key in products), default=0)
        savings = max(0, sum(row.price for row in products.values()) - promotion.discount_value)
        return min(sum(sum(total.amounts.values()) for total in qualifying), savings * count)
    discount = 0
    for total in qualifying:
        eligible = sum(total.amounts.values())
        if promotion.discount_type == ShopDiscountType.PRICE_OVERRIDE:
            amount = sum(
                max(0, products[row.product_id].price - row.unit_price)
                * total.quantities.get(row.product_id, 0)
                for row in promotion.product_price_overrides
                if row.product_id in products
            )
        elif promotion.discount_type == ShopDiscountType.PERCENTAGE:
            if promotion.discount_value == 100 and products:
                amount = sum(
                    min(value, products[key].price * total.quantities.get(key, 0))
                    for key, value in total.amounts.items()
                )
            else:
                amount = eligible * promotion.discount_value // 100
        else:
            amount = promotion.discount_value
        discount += min(eligible, amount)
    return discount
