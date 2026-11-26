import uuid
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.school_class import ClassRosterEntry
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductSeries
from api.schemas.shop import OrderPurchaseDetailRow
from api.services import school_class as class_svc


async def purchase_details_report(
    session: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    grade: int | None = None,
    class_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    status: OrderStatus | None = None,
    is_paid: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[OrderPurchaseDetailRow]:
    statement = (
        select(Order)
        .options(
            selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.series),
            selectinload(Order.school_class),
            selectinload(Order.user),
        )
        .where(Order.test_product_id.is_(None))
    )
    if status is not None:
        statement = statement.where(Order.status == status)
    else:
        statement = statement.where(
            Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED])
        )
    if activity_id is not None:
        statement = statement.where(Order.activity_id == activity_id)
    if category_id is not None:
        statement = statement.where(
            Order.items.any(
                OrderItem.product.has(
                    or_(
                        Product.category_id == category_id,
                        Product.series.has(ProductSeries.category_id == category_id),
                    )
                )
            )
        )
    if product_id is not None:
        statement = statement.where(Order.items.any(OrderItem.product_id == product_id))
    if grade is not None:
        statement = statement.where(Order.school_class.has(grade=grade))
    if class_id is not None:
        statement = statement.where(Order.class_id == class_id)
    if user_id is not None:
        statement = statement.where(Order.user_id == user_id)
    if is_paid is not None:
        statement = statement.where(Order.is_paid.is_(is_paid))
    if date_from is not None:
        statement = statement.where(Order.created_at >= date_from)
    if date_to is not None:
        statement = statement.where(Order.created_at <= date_to)

    orders = (await session.execute(statement)).scalars().unique().all()
    class_ids = {order.class_id for order in orders if order.class_id is not None}
    roster = (
        (
            await session.execute(
                select(ClassRosterEntry).where(ClassRosterEntry.class_id.in_(class_ids))
            )
        )
        .scalars()
        .all()
        if class_ids
        else []
    )
    seats_by_user = {
        (entry.class_id, entry.user_id): entry.seat_number for entry in roster if entry.user_id
    }
    seats_by_student = {(entry.class_id, entry.student_id): entry.seat_number for entry in roster}
    grouped: dict[tuple[uuid.UUID | None, str, uuid.UUID, str], dict] = {}
    for order in orders:
        school_class = order.school_class
        class_label = class_svc.class_display_label(school_class) or "未分班"
        buyer_label = order.buyer_name or (order.user.display_name if order.user else "組織訂購人")
        buyer_key = str(order.user_id) if order.user_id else f"external:{order.id}"
        seat_number = seats_by_user.get((order.class_id, order.user_id))
        if seat_number is None and order.user and order.user.student_id:
            seat_number = seats_by_student.get((order.class_id, order.user.student_id))

        for item in order.items:
            product = item.product
            if product is None:
                continue
            if product_id is not None and item.product_id != product_id:
                continue
            if category_id is not None and not (
                product.category_id == category_id
                or (product.series is not None and product.series.category_id == category_id)
            ):
                continue

            options = sorted(
                item.selected_options or [],
                key=lambda option: str(option.get("group_name", "")),
            )
            variant_key = (
                " / ".join(
                    f"{option.get('group_name', '')}：{option.get('value', '')}"
                    for option in options
                )
                or "—"
            )
            key = (order.class_id, buyer_key, item.product_id, variant_key)
            row = grouped.setdefault(
                key,
                {
                    "class_id": order.class_id,
                    "class_label": class_label,
                    "grade": school_class.grade if school_class else None,
                    "class_code": school_class.class_code if school_class else "",
                    "seat_number": seat_number,
                    "user_id": order.user_id,
                    "buyer_label": buyer_label,
                    "product_id": item.product_id,
                    "product_name": product.name,
                    "variant_key": variant_key,
                    "quantity": 0,
                    "order_ids": set(),
                },
            )
            row["quantity"] += item.quantity
            row["order_ids"].add(order.id)

    ordered_rows = sorted(
        grouped.values(),
        key=lambda row: (
            row["grade"] if row["grade"] is not None else 99,
            row["class_code"],
            row["class_label"],
            row["buyer_label"],
            row["product_name"],
            row["variant_key"],
        ),
    )
    return [
        OrderPurchaseDetailRow(**{**row, "order_count": len(row["order_ids"])})
        for row in ordered_rows
    ]
