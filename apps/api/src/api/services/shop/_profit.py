"""以商品所屬主題的全期有效訂單與整批採購計算盈利，不調整銷售庫存。"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ProductStatus,
    ProductVariantGroup,
)
from api.schemas.shop_profit import (
    ProductProcurementUpdate,
    ShopProfitOption,
    ShopProfitOut,
    ShopProfitProduct,
    ShopProfitSummary,
)
from api.services.shop._analytics import _allocate_amounts
from api.services.shop._costs import option_cost_key, option_unit_cost, selected_cost_options

PLAN_FIELDS = {
    "minimum_order_quantity": "procurement_minimum",
    "stock_extra_quantity": "procurement_stock",
    "reserve_quantity": "procurement_reserve",
    "supplier_gift_quantity": "procurement_supplier_gift",
    "extra_cost": "procurement_extra_cost",
    "note": "procurement_note",
    "unit_cost": "unit_cost",
    "option_costs": "procurement_option_costs",
}


async def update_procurement(
    session: AsyncSession, product: Product, data: ProductProcurementUpdate
) -> None:
    for key, field in PLAN_FIELDS.items():
        setattr(product, field, getattr(data, key))
    await session.flush()


def _profit_options(product: Product, items: list[OrderItem]) -> list[ShopProfitOption]:
    rows: dict[str, ShopProfitOption] = {}
    configured = product.procurement_option_costs or {}

    def add(snapshot: dict) -> ShopProfitOption:
        key = option_cost_key(snapshot)
        if key not in rows:
            rows[key] = ShopProfitOption(
                key=key,
                group_name=str(snapshot.get("group_name", "")),
                value=str(snapshot.get("value", "")),
                unit_cost=option_unit_cost(product, key, snapshot),
                ordered_quantity=0,
                total_cost=0,
            )
        return rows[key]

    for group in product.variant_groups:
        for option in group.options:
            snapshot = {
                "option_id": str(option.id),
                "group_name": group.name,
                "value": option.value,
                "price_delta": option.price_delta,
            }
            if option.price_delta > 0 or option_cost_key(snapshot) in configured:
                add(snapshot)
    for item in items:
        for key, snapshot in selected_cost_options(item.selected_options or []).items():
            if key not in rows and snapshot.get("price_delta", 0) <= 0 and key not in configured:
                continue
            row = add(snapshot)
            cost = option_unit_cost(product, key, snapshot)
            row.ordered_quantity += item.quantity
            if cost is None:
                row.unit_cost = row.total_cost = None
            elif row.total_cost is not None:
                row.total_cost += item.quantity * cost
    return list(rows.values())


def _product_profit(
    product: Product, quantity: int, revenue: int, paid: int, items: list[OrderItem]
) -> ShopProfitProduct:
    plan = ProductProcurementUpdate(
        **{key: getattr(product, field) for key, field in PLAN_FIELDS.items()}
    )
    required = quantity + plan.stock_extra_quantity + plan.reserve_quantity
    paid_required = max(0, required - plan.supplier_gift_quantity)
    purchase = max(paid_required, plan.minimum_order_quantity)
    stock = purchase + plan.supplier_gift_quantity - quantity - plan.reserve_quantity
    # 贈品依序供訂單、不可售備品、可售庫存；各項成本只計付費商品。
    paid_order = max(0, quantity - plan.supplier_gift_quantity)
    paid_reserve = max(0, plan.reserve_quantity - max(0, plan.supplier_gift_quantity - quantity))
    paid_stock = purchase - paid_order - paid_reserve

    def cost(count: int) -> int | None:
        return 0 if not count else None if plan.unit_cost is None else count * plan.unit_cost

    goods_cost = cost(purchase)
    options = _profit_options(product, items)
    option_costs = [row.total_cost for row in options]
    option_cost = (
        None if None in option_costs else sum(cost for cost in option_costs if cost is not None)
    )
    total_cost = (
        None
        if goods_cost is None or option_cost is None
        else goods_cost + plan.extra_cost + option_cost
    )
    base_order_cost = cost(paid_order)
    return ShopProfitProduct(
        product_id=product.id,
        name=product.name,
        price=product.price,
        plan=plan,
        options=options,
        option_cost=option_cost,
        ordered_quantity=quantity,
        revenue=revenue,
        paid_amount=paid,
        purchase_quantity=purchase,
        minimum_top_up_quantity=purchase - paid_required,
        sellable_stock_quantity=stock,
        order_cost=None
        if base_order_cost is None or option_cost is None
        else base_order_cost + option_cost,
        inventory_cost=cost(paid_stock),
        reserve_cost=cost(paid_reserve),
        total_cost=total_cost,
        profit_amount=None if total_cost is None else revenue - total_cost,
        cash_balance=None if total_cost is None else paid - total_cost,
    )


async def profit_analysis(session: AsyncSession, category: ProductCategory) -> ShopProfitOut:
    products = list(
        await session.scalars(
            select(Product)
            .options(selectinload(Product.variant_groups).selectinload(ProductVariantGroup.options))
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
    product_items: dict[UUID, list[OrderItem]] = {product_id: [] for product_id in ids}
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
                    product_items[item.product_id].append(item)
    rows = [
        _product_profit(product, *amounts[product.id], product_items[product.id])
        for product in products
    ]
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
    summary.supplier_gift_quantity = sum(row.plan.supplier_gift_quantity for row in rows)
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
