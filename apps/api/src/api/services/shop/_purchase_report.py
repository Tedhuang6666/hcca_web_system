import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import TypedDict, Unpack

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.school_class import ClassRosterEntry
from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductSeries,
    ProductVariantGroup,
    ProductVariantOption,
)
from api.schemas.shop import OrderPurchaseDetailRow
from api.services import school_class as class_svc


@dataclass
class ClassSheetBuyer:
    key: str
    name: str
    seat: int | None
    items: list[str] = field(default_factory=list)


@dataclass
class ClassSheetPage:
    key: str
    class_label: str
    academic_year: int | None
    class_code: str
    grade: int | None
    buyers: list[ClassSheetBuyer]


@dataclass
class ClassTotalLine:
    product_id: uuid.UUID
    product_name: str
    option_label: str
    unit_price: int
    quantity: int
    option_sort_key: tuple[tuple[int, int, str, str], ...] = ()

    @property
    def subtotal(self) -> int:
        return self.unit_price * self.quantity


@dataclass
class ClassTotalsPage:
    key: str
    class_label: str
    academic_year: int | None
    class_code: str
    grade: int | None
    lines: list[ClassTotalLine]


ClassSheetItemKey = tuple[uuid.UUID, tuple[tuple[str, str], ...]]
ClassSheetItemValue = tuple[int, tuple[tuple[int, int, str, str], ...], str, int]


@dataclass
class _ClassSheetGroup:
    class_label: str
    academic_year: int | None
    class_code: str
    grade: int | None
    buyers: dict[str, ClassSheetBuyer] = field(default_factory=dict)
    items_by_buyer: dict[str, dict[ClassSheetItemKey, ClassSheetItemValue]] = field(
        default_factory=dict
    )


@dataclass
class _ClassTotalsGroup:
    class_label: str
    academic_year: int | None
    class_code: str
    grade: int | None
    lines: dict[tuple[uuid.UUID, tuple[tuple[str, str], ...], int], ClassTotalLine] = field(
        default_factory=dict
    )


class _PurchaseFilters(TypedDict):
    activity_id: uuid.UUID | None
    category_id: uuid.UUID | None
    product_id: uuid.UUID | None
    grade: int | None
    class_id: uuid.UUID | None
    user_id: uuid.UUID | None
    status: OrderStatus | None
    is_paid: bool | None
    date_from: datetime | None
    date_to: datetime | None


def _purchase_order_query(
    session: AsyncSession,
    **filters: Unpack[_PurchaseFilters],
) -> Select[tuple[Order]]:
    activity_id = filters["activity_id"]
    category_id = filters["category_id"]
    product_id = filters["product_id"]
    grade = filters["grade"]
    class_id = filters["class_id"]
    user_id = filters["user_id"]
    status = filters["status"]
    is_paid = filters["is_paid"]
    date_from = filters["date_from"]
    date_to = filters["date_to"]
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
    return statement.order_by(Order.created_at, Order.id)


async def _purchase_orders(
    session: AsyncSession,
    **filters: Unpack[_PurchaseFilters],
) -> list[Order]:
    statement = _purchase_order_query(session, **filters)
    return list((await session.execute(statement)).scalars().unique().all())


def _item_matches_scope(
    item: OrderItem,
    *,
    category_id: uuid.UUID | None,
    product_id: uuid.UUID | None,
) -> bool:
    product = item.product
    if product is None or (product_id is not None and item.product_id != product_id):
        return False
    return (
        category_id is None
        or product.category_id == category_id
        or (product.series is not None and product.series.category_id == category_id)
    )


def _variant_options(item: OrderItem) -> list[tuple[str, str]]:
    return [
        (str(option.get("group_name", "")), str(option.get("value", "")))
        for option in (item.selected_options or [])
    ]


async def _variant_option_sort_orders(
    session: AsyncSession, orders: list[Order]
) -> dict[str, tuple[int, int]]:
    option_ids: set[uuid.UUID] = set()
    for order in orders:
        for item in order.items:
            for option in item.selected_options or []:
                try:
                    option_ids.add(uuid.UUID(str(option.get("option_id", ""))))
                except (AttributeError, TypeError, ValueError):
                    continue
    if not option_ids:
        return {}
    rows = await session.execute(
        select(ProductVariantOption.id, ProductVariantGroup.sort_order, ProductVariantOption.sort_order)
        .join(ProductVariantGroup, ProductVariantGroup.id == ProductVariantOption.group_id)
        .where(ProductVariantOption.id.in_(option_ids))
    )
    return {
        str(option_id): (group_order, option_order)
        for option_id, group_order, option_order in rows.all()
    }


def _variant_sort_key(
    item: OrderItem, option_orders: dict[str, tuple[int, int]]
) -> tuple[tuple[int, int, str, str], ...]:
    result = []
    for index, option in enumerate(item.selected_options or []):
        group_name = str(option.get("group_name", ""))
        value = str(option.get("value", ""))
        group_order, default_option_order = option_orders.get(
            str(option.get("option_id", "")), (index, index)
        )
        result.append((group_order, default_option_order, group_name, value))
    return tuple(result)


def _product_positions_from_orders(orders: list[Order]) -> dict[uuid.UUID, int]:
    products = {
        item.product_id: item.product
        for order in orders
        for item in order.items
        if item.product is not None
    }
    ordered_ids = sorted(
        products,
        key=lambda product_id: (
            products[product_id].created_at.isoformat()
            if products[product_id].created_at is not None
            else "",
            str(product_id),
        ),
    )
    return {product_id: index for index, product_id in enumerate(ordered_ids)}


async def class_sheet_report(
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
) -> list[ClassSheetPage]:
    orders = await _purchase_orders(
        session,
        activity_id=activity_id,
        category_id=category_id,
        product_id=product_id,
        grade=grade,
        class_id=class_id,
        user_id=user_id,
        status=status,
        is_paid=is_paid,
        date_from=date_from,
        date_to=date_to,
    )
    option_orders = await _variant_option_sort_orders(session, orders)
    product_positions = _product_positions_from_orders(orders)
    class_ids = {order.class_id for order in orders if order.class_id is not None}
    roster = (
        list(
            (
                await session.execute(
                    select(ClassRosterEntry).where(ClassRosterEntry.class_id.in_(class_ids))
                )
            )
            .scalars()
            .all()
        )
        if class_ids
        else []
    )
    seats_by_user = {
        (entry.class_id, entry.user_id): entry.seat_number for entry in roster if entry.user_id
    }
    seats_by_student = {(entry.class_id, entry.student_id): entry.seat_number for entry in roster}
    groups: dict[uuid.UUID | None, _ClassSheetGroup] = {}
    for order in orders:
        school_class = order.school_class
        matching_items = [
            item
            for item in order.items
            if _item_matches_scope(item, category_id=category_id, product_id=product_id)
        ]
        if not matching_items:
            continue
        class_label = class_svc.class_display_label(school_class) or "未分班"
        group = groups.setdefault(
            order.class_id,
            _ClassSheetGroup(
                class_label=class_label,
                academic_year=school_class.academic_year if school_class else None,
                class_code=school_class.class_code if school_class else "",
                grade=school_class.grade if school_class else None,
            ),
        )
        seat_number = seats_by_user.get((order.class_id, order.user_id))
        if seat_number is None and order.user and order.user.student_id:
            seat_number = seats_by_student.get((order.class_id, order.user.student_id))
        buyer_key = str(order.user_id) if order.user_id else f"external:{order.id}"
        buyer = group.buyers.setdefault(
            buyer_key,
            ClassSheetBuyer(
                key=buyer_key,
                name=order.buyer_name or (order.user.display_name if order.user else "組織訂購人"),
                seat=seat_number,
            ),
        )
        for item in matching_items:
            product = item.product
            if product is None:
                continue
            options = _variant_options(item)
            variant = " / ".join(f"{group}：{value}" for group, value in options) or "—"
            suffix = "" if variant == "—" else f"（{variant}）"
            item_key = (item.product_id, tuple(options))
            item_rows = group.items_by_buyer.setdefault(buyer_key, {})
            previous = item_rows.get(item_key)
            item_rows[item_key] = (
                product_positions.get(item.product_id, len(product_positions)),
                _variant_sort_key(item, option_orders),
                f"{product.name}{suffix}",
                item.quantity + (previous[3] if previous else 0),
            )

    for group in groups.values():
        for buyer_key, buyer in group.buyers.items():
            buyer.items = [
                f"{row[2]} × {row[3]:,}"
                for row in sorted(
                    group.items_by_buyer.get(buyer_key, {}).values(),
                    key=lambda row: (row[0], row[1], row[2]),
                )
            ]

    pages = [
        ClassSheetPage(
            key=str(class_id) if class_id is not None else "unassigned",
            class_label=group.class_label,
            academic_year=group.academic_year,
            class_code=group.class_code,
            grade=group.grade,
            buyers=sorted(
                group.buyers.values(),
                key=lambda buyer: (buyer.seat is None, buyer.seat or 0, buyer.name),
            ),
        )
        for class_id, group in groups.items()
    ]
    return sorted(
        pages,
        key=lambda page: (
            page.academic_year if page.academic_year is not None else 999,
            page.grade if page.grade is not None else 99,
            page.class_code,
            page.class_label,
        ),
    )


async def class_totals_report(
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
) -> list[ClassTotalsPage]:
    orders = await _purchase_orders(
        session,
        activity_id=activity_id,
        category_id=category_id,
        product_id=product_id,
        grade=grade,
        class_id=class_id,
        user_id=user_id,
        status=status,
        is_paid=is_paid,
        date_from=date_from,
        date_to=date_to,
    )
    option_orders = await _variant_option_sort_orders(session, orders)
    groups: dict[uuid.UUID | None, _ClassTotalsGroup] = {}
    for order in orders:
        school_class = order.school_class
        for item in order.items:
            if not _item_matches_scope(item, category_id=category_id, product_id=product_id):
                continue
            product = item.product
            if product is None:
                continue
            class_label = class_svc.class_display_label(school_class) or "未分班"
            group = groups.setdefault(
                order.class_id,
                _ClassTotalsGroup(
                    class_label=class_label,
                    academic_year=school_class.academic_year if school_class else None,
                    class_code=school_class.class_code if school_class else "",
                    grade=school_class.grade if school_class else None,
                ),
            )
            options = _variant_options(item)
            option_key = tuple(options)
            if len(options) < 2 or len({name for name, _ in options}) == 1:
                option_label = " / ".join(value for _, value in options)
            else:
                option_label = " / ".join(f"{name}：{value}" for name, value in options)
            key = (item.product_id, option_key, item.unit_price)
            line = group.lines.setdefault(
                key,
                ClassTotalLine(
                    product_id=item.product_id,
                    product_name=product.name,
                    option_label=option_label,
                    unit_price=item.unit_price,
                    quantity=0,
                    option_sort_key=_variant_sort_key(item, option_orders),
                ),
            )
            line.quantity += item.quantity

    product_positions = _product_positions_from_orders(orders)
    pages = [
        ClassTotalsPage(
            key=str(class_id) if class_id is not None else "unassigned",
            class_label=group.class_label,
            academic_year=group.academic_year,
            class_code=group.class_code,
            grade=group.grade,
            lines=sorted(
                group.lines.values(),
                key=lambda line: (
                    product_positions.get(line.product_id, len(product_positions)),
                    line.option_sort_key,
                    line.unit_price,
                ),
            ),
        )
        for class_id, group in groups.items()
    ]
    return sorted(
        pages,
        key=lambda page: (
            page.academic_year if page.academic_year is not None else 999,
            page.grade if page.grade is not None else 99,
            page.class_code,
            page.class_label,
        ),
    )


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
    orders = await _purchase_orders(
        session,
        activity_id=activity_id,
        category_id=category_id,
        product_id=product_id,
        grade=grade,
        class_id=class_id,
        user_id=user_id,
        status=status,
        is_paid=is_paid,
        date_from=date_from,
        date_to=date_to,
    )
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
