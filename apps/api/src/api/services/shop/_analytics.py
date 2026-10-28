"""依目前有效訂單快照分析銷售；不寫入或調整訂單資料。"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from statistics import median

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import TAIPEI, local_today
from api.models.shop import Order, OrderItem, OrderStatus, Product
from api.schemas.shop_analytics import (
    ShopSalesAnalyticsOut,
    ShopSalesCrossRow,
    ShopSalesDay,
    ShopSalesMetrics,
    ShopSalesPeriod,
    ShopSalesRow,
)
from api.services.school_class import class_display_label
from api.services.shop._analytics_insights import build_sales_insights


def _allocate_amounts(order: Order) -> dict[uuid.UUID, int]:
    """按明細原價分攤實際應繳金額；最大餘數法確保各明細加總等於整單。"""
    items = sorted(order.items, key=lambda item: str(item.id))
    gross = sum(item.quantity * item.unit_price for item in items)
    if not gross:
        return {item.id: 0 for item in items}
    amounts = {
        item.id: order.total_price * item.quantity * item.unit_price // gross for item in items
    }
    remainder = order.total_price - sum(amounts.values())
    ranked = sorted(
        items,
        key=lambda item: (
            -(order.total_price * item.quantity * item.unit_price % gross),
            str(item.id),
        ),
    )
    for item in ranked[:remainder]:
        amounts[item.id] += 1
    return amounts


async def sales_analytics(
    session: AsyncSession,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    compare: bool = False,
    compare_from: date | None = None,
    activity_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    grade: int | None = None,
    class_id: uuid.UUID | None = None,
    is_paid: bool | None = None,
) -> ShopSalesAnalyticsOut:
    end = date_to or local_today()
    start = date_from or end - timedelta(days=29)
    days = (end - start).days + 1
    if not 1 <= days <= 366:
        raise ValueError("訂購迄日不得早於起日，每次最多分析 366 天")
    previous_start = compare_from or start - timedelta(days=days)
    previous_end = previous_start + timedelta(days=days - 1)
    ranges = [(start, end)] + ([(previous_start, previous_end)] if compare else [])
    periods = []
    for period_start, period_end in ranges:
        query = (
            select(Order)
            .options(
                selectinload(Order.items)
                .selectinload(OrderItem.product)
                .selectinload(Product.series),
                selectinload(Order.school_class),
            )
            .where(
                Order.test_product_id.is_(None),
                Order.created_at >= datetime.combine(period_start, time.min, TAIPEI),
                Order.created_at
                < datetime.combine(period_end + timedelta(days=1), time.min, TAIPEI),
            )
        )
        if activity_id is not None:
            query = query.where(Order.activity_id == activity_id)
        if grade is not None:
            query = query.where(Order.school_class.has(grade=grade))
        if class_id is not None:
            query = query.where(Order.class_id == class_id)
        if is_paid is not None:
            query = query.where(Order.is_paid.is_(is_paid))
        if product_id is not None:
            query = query.where(Order.items.any(OrderItem.product_id == product_id))
        if category_id is not None:
            query = query.where(
                Order.items.any(
                    OrderItem.product.has(
                        or_(
                            Product.category_id == category_id,
                            Product.series.has(category_id=category_id),
                        )
                    )
                )
            )
        orders = (await session.scalars(query)).unique().all()
        periods.append(_summarize(orders, period_start, period_end, product_id, category_id))
    previous = periods[1] if compare else None
    return ShopSalesAnalyticsOut(
        generated_at=datetime.now(UTC),
        current=periods[0],
        previous=previous,
        insights=build_sales_insights(periods[0], previous),
    )


def _summarize(
    orders: list[Order],
    start: date,
    end: date,
    product_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
) -> ShopSalesPeriod:
    metrics = ShopSalesMetrics()
    groups: dict[str, dict[str, ShopSalesRow]] = defaultdict(dict)
    seen: dict[tuple[str, str], set[uuid.UUID]] = defaultdict(set)
    group_buyers: dict[tuple[str, str], set[uuid.UUID]] = defaultdict(set)
    buyers: set[uuid.UUID] = set()
    positive_amounts: list[int] = []
    buyer_orders: dict[uuid.UUID, int] = defaultdict(int)
    active_records: list[tuple[Order, int, int, int]] = []
    cross_meta: dict[str, dict[str, dict]] = defaultdict(dict)

    def add(
        kind: str,
        key: str,
        label: str,
        order: Order,
        quantity: int,
        amount: int,
        gross: int | None = None,
    ) -> None:
        row = groups[kind].setdefault(key, ShopSalesRow(key=key, label=label))
        if order.id not in seen[kind, key]:
            row.order_count += 1
            seen[kind, key].add(order.id)
        group_buyers[kind, key].add(order.user_id)
        row.buyer_count = len(group_buyers[kind, key])
        row.item_count += quantity
        row.total_amount += amount
        row.paid_amount += amount if order.is_paid else 0
        row.gross_amount += amount if gross is None else gross
        row.discount_amount += 0 if gross is None else gross - amount

    for order in orders:
        items = [
            item
            for item in order.items
            if (product_id is None or item.product_id == product_id)
            and (
                category_id is None
                or item.product.category_id == category_id
                or (item.product.series and item.product.series.category_id == category_id)
            )
        ]
        if not items:
            continue
        amounts = _allocate_amounts(order)
        amount = sum(amounts[item.id] for item in items)
        quantity = sum(item.quantity for item in items)
        discount = sum(item.quantity * item.unit_price for item in items) - amount
        gross = amount + discount
        status_labels = {
            "pending": "待確認",
            "confirmed": "已確認",
            "cancelled": "已取消",
            "refunded": "已退款",
        }
        add(
            "statuses",
            order.status.value,
            status_labels.get(order.status.value, order.status.value),
            order,
            quantity,
            amount,
            gross,
        )
        if order.status in (OrderStatus.CANCELLED, OrderStatus.REFUNDED):
            continue
        active_records.append((order, quantity, amount, gross))
        buyer_orders[order.user_id] += 1
        metrics.order_count += 1
        metrics.item_count += quantity
        metrics.total_amount += amount
        metrics.paid_amount += amount if order.is_paid else 0
        metrics.discount_amount += discount
        metrics.discounted_order_count += int(discount > 0)
        buyers.add(order.user_id)
        if amount > 0:
            positive_amounts.append(amount)
        created = order.created_at
        local = (created if created.tzinfo else created.replace(tzinfo=UTC)).astimezone(TAIPEI)
        sc = order.school_class
        source = order.assistance_scope
        for kind, key, label in [
            ("daily", local.date().isoformat(), local.date().isoformat()),
            ("hours", str(local.hour), f"{local.hour:02d}:00"),
            ("weekdays", str(local.weekday()), f"週{'一二三四五六日'[local.weekday()]}"),
            (
                "weekday_hours",
                str(local.weekday() * 24 + local.hour),
                f"週{'一二三四五六日'[local.weekday()]} {local.hour:02d}:00",
            ),
            ("grades", str(sc.grade) if sc else "none", f"{sc.grade} 年級" if sc else "未分班"),
            ("classes", str(sc.id) if sc else "none", class_display_label(sc) or "未分班"),
            (
                "sources",
                source,
                {"self": "自行訂購（含家人授權）", "class_assisted": "班代代訂"}.get(
                    source, source
                ),
            ),
            ("amount_bands", str(min((amount - 1) // 500, 6)) if amount else "zero", ""),
            (
                "item_bands",
                str(quantity) if quantity <= 5 else "6–9" if quantity < 10 else "10+",
                "",
            ),
        ]:
            add(kind, key, label, order, quantity, amount, gross)
        for item in items:
            product = item.product
            item_gross = item.quantity * item.unit_price
            add(
                "products",
                str(product.id),
                product.name,
                order,
                item.quantity,
                amounts[item.id],
                item_gross,
            )
            for kind, dimension_key, dimension_label in [
                (
                    "grade_products",
                    str(sc.grade) if sc else "none",
                    f"{sc.grade} 年級" if sc else "未分班",
                ),
                (
                    "class_products",
                    str(sc.id) if sc else "none",
                    class_display_label(sc) or "未分班",
                ),
            ]:
                key = f"{dimension_key}:{product.id}"
                add(
                    kind,
                    key,
                    f"{dimension_label} · {product.name}",
                    order,
                    item.quantity,
                    amounts[item.id],
                    item_gross,
                )
                cross_meta[kind][key] = dict(
                    dimension_key=dimension_key,
                    dimension_label=dimension_label,
                    product_id=product.id,
                    product_name=product.name,
                )
            options = (
                " / ".join(
                    f"{option['group_name']}：{option['value']}"
                    for option in sorted(
                        item.selected_options or [], key=lambda option: option.get("group_name", "")
                    )
                )
                or "無規格"
            )
            add(
                "variants",
                f"{product.id}:{options}",
                f"{product.name} · {options}",
                order,
                item.quantity,
                amounts[item.id],
                item_gross,
            )

    metrics.buyer_count = len(buyers)
    metrics.median_order_amount = float(median(positive_amounts)) if positive_amounts else 0
    metrics.average_buyer_amount = round(metrics.total_amount / len(buyers), 2) if buyers else 0
    metrics.repeat_buyer_count = sum(count > 1 for count in buyer_orders.values())
    metrics.repeat_buyer_rate = (
        round(metrics.repeat_buyer_count / len(buyers) * 100, 2) if buyers else 0
    )
    for order, quantity, amount, gross in active_records:
        count = buyer_orders[order.user_id]
        key = str(count) if count < 3 else "3+"
        add("buyer_segments", key, f"{key} 筆訂單", order, quantity, amount, gross)
    metrics.unpaid_amount = metrics.total_amount - metrics.paid_amount
    metrics.average_order_amount = (
        round(sum(positive_amounts) / len(positive_amounts), 2) if positive_amounts else 0
    )
    if metrics.order_count:
        metrics.average_items_per_order = round(metrics.item_count / metrics.order_count, 2)
        metrics.promotion_usage_rate = round(
            metrics.discounted_order_count / metrics.order_count * 100, 2
        )
    if metrics.total_amount:
        metrics.payment_rate = round(metrics.paid_amount / metrics.total_amount * 100, 2)
    daily = []
    cumulative = 0
    for index in range((end - start).days + 1):
        key = (start + timedelta(days=index)).isoformat()
        row = groups["daily"].get(key, ShopSalesRow(key=key, label=key))
        cumulative += row.total_amount
        daily.append(ShopSalesDay(**row.model_dump(), cumulative_amount=cumulative))

    def rows(kind: str) -> list[ShopSalesRow]:
        return sorted(groups[kind].values(), key=lambda row: (-row.item_count, row.label))

    bands = (
        [("zero", "NT$0")]
        + [(str(i), f"NT${i * 500 + 1:,}–{(i + 1) * 500:,}") for i in range(6)]
        + [("6", "NT$3,001 以上")]
    )
    amount_bands = [
        groups["amount_bands"]
        .get(key, ShopSalesRow(key=key, label=label))
        .model_copy(update={"label": label})
        for key, label in bands
    ]
    item_bands = [
        groups["item_bands"]
        .get(key, ShopSalesRow(key=key, label=key))
        .model_copy(update={"label": f"{key} 件"})
        for key in ["1", "2", "3", "4", "5", "6–9", "10+"]
    ]
    return ShopSalesPeriod(
        date_from=start,
        date_to=end,
        metrics=metrics,
        daily=daily,
        grades=rows("grades"),
        classes=rows("classes"),
        products=rows("products"),
        variants=rows("variants"),
        sources=rows("sources"),
        amount_bands=amount_bands,
        item_bands=item_bands,
        hours=[
            groups["hours"].get(str(hour), ShopSalesRow(key=str(hour), label=f"{hour:02d}:00"))
            for hour in range(24)
        ],
        weekdays=[
            groups["weekdays"].get(
                str(day), ShopSalesRow(key=str(day), label=f"週{'一二三四五六日'[day]}")
            )
            for day in range(7)
        ],
        weekday_hours=[
            groups["weekday_hours"].get(
                str(cell),
                ShopSalesRow(
                    key=str(cell), label=f"週{'一二三四五六日'[cell // 24]} {cell % 24:02d}:00"
                ),
            )
            for cell in range(168)
        ],
        statuses=rows("statuses"),
        buyer_segments=rows("buyer_segments"),
        grade_products=[
            ShopSalesCrossRow(**row.model_dump(), **cross_meta["grade_products"][row.key])
            for row in rows("grade_products")
        ],
        class_products=[
            ShopSalesCrossRow(**row.model_dump(), **cross_meta["class_products"][row.key])
            for row in rows("class_products")
        ],
    )
