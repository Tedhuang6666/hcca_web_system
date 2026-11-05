"""以商品所屬主題的全期有效訂單與整批採購計算盈利，不調整銷售庫存。"""

from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory, ProductStatus
from api.schemas.shop_profit import (
    ProductProcurementUpdate,
    ShopProfitOut,
    ShopProfitProduct,
    ShopProfitSummary,
)
from api.services.shop._analytics import _allocate_amounts

PLAN_FIELDS = {
    "minimum_order_quantity": "procurement_minimum",
    "stock_extra_quantity": "procurement_stock",
    "reserve_quantity": "procurement_reserve",
    "extra_cost": "procurement_extra_cost",
    "note": "procurement_note",
    "unit_cost": "unit_cost",
}


async def update_procurement(
    session: AsyncSession, product: Product, data: ProductProcurementUpdate
) -> None:
    for key, field in PLAN_FIELDS.items():
        setattr(product, field, getattr(data, key))
    await session.flush()


def _product_profit(product: Product, quantity: int, revenue: int, paid: int) -> ShopProfitProduct:
    plan = ProductProcurementUpdate(
        **{key: getattr(product, field) for key, field in PLAN_FIELDS.items()}
    )
    required = quantity + plan.stock_extra_quantity + plan.reserve_quantity
    purchase = max(required, plan.minimum_order_quantity)
    stock = purchase - quantity - plan.reserve_quantity

    def cost(count: int) -> int | None:
        return 0 if not count else None if plan.unit_cost is None else count * plan.unit_cost

    goods_cost = cost(purchase)
    total_cost = None if goods_cost is None else goods_cost + plan.extra_cost
    return ShopProfitProduct(
        product_id=product.id,
        name=product.name,
        price=product.price,
        plan=plan,
        ordered_quantity=quantity,
        revenue=revenue,
        paid_amount=paid,
        purchase_quantity=purchase,
        minimum_top_up_quantity=purchase - required,
        sellable_stock_quantity=stock,
        order_cost=cost(quantity),
        inventory_cost=cost(stock),
        reserve_cost=cost(plan.reserve_quantity),
        total_cost=total_cost,
        profit_amount=None if total_cost is None else revenue - total_cost,
        cash_balance=None if total_cost is None else paid - total_cost,
    )


async def profit_analysis(session: AsyncSession, category: ProductCategory) -> ShopProfitOut:
    products = list(
        await session.scalars(
            select(Product)
            .where(
                or_(
                    Product.category_id == category.id,
                    Product.series.has(category_id=category.id),
                ),
                Product.status != ProductStatus.TESTING,
            )
            .order_by(Product.created_at, Product.id)
        )
    )
    ids = {product.id for product in products}
    amounts = {product_id: [0, 0, 0] for product_id in ids}
    if ids:
        orders = await session.scalars(
            select(Order)
            .options(selectinload(Order.items))
            .where(
                Order.test_product_id.is_(None),
                Order.status.not_in((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
                Order.items.any(OrderItem.product_id.in_(ids)),
            )
        )
        for order in orders:
            allocated = _allocate_amounts(order)
            for item in order.items:
                if item.product_id in amounts:
                    totals = amounts[item.product_id]
                    totals[0] += item.quantity
                    totals[1] += allocated[item.id]
                    totals[2] += allocated[item.id] if order.is_paid else 0
    rows = [_product_profit(product, *amounts[product.id]) for product in products]
    summary = ShopProfitSummary()
    for field in (
        "ordered_quantity",
        "purchase_quantity",
        "sellable_stock_quantity",
        "minimum_top_up_quantity",
        "revenue",
        "paid_amount",
    ):
        setattr(summary, field, sum(getattr(row, field) for row in rows))
    summary.reserve_quantity = sum(row.plan.reserve_quantity for row in rows)
    summary.extra_cost = sum(row.plan.extra_cost for row in rows)
    summary.unpaid_amount = summary.revenue - summary.paid_amount
    summary.missing_cost_product_count = sum(row.total_cost is None for row in rows)
    for field in (
        "order_cost",
        "inventory_cost",
        "reserve_cost",
        "total_cost",
        "profit_amount",
        "cash_balance",
    ):
        values = [getattr(row, field) for row in rows]
        setattr(summary, field, None if None in values else sum(values))
    return ShopProfitOut(
        category_id=category.id,
        category_name=category.name,
        generated_at=datetime.now(UTC),
        summary=summary,
        products=rows,
    )
