"""訂單列表彙總與班級訂單查詢。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, func, select, union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.models.activity import Activity
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationStatus,
)
from api.models.school_class import (
    ClassManualMember,
    ClassRosterEntry,
    ClassStudentRange,
    SchoolClass,
)
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductSeries
from api.models.shop_class_payment import ShopClassPayment
from api.models.user import User
from api.schemas.shop import (
    ClassPaymentReportItemOut,
    OrderQuantityRow,
    OrderSummaryOut,
    OrderSummaryRow,
    ShopClassProductSummaryRow,
    ShopClassSummaryOut,
)
from api.services import receivable as receivable_svc
from api.services import school_class as class_svc
from api.services.shop._orders import _product_category_filter, list_orders


async def _reconcile_unassigned_class_orders(
    session: AsyncSession, class_ids: list[uuid.UUID]
) -> None:
    """補齊班級成員尚未歸班的有效訂單，保留既有班級快照。"""
    today = local_today()
    member_user_ids = union(
        select(Person.user_id)
        .join(PersonAffiliation, PersonAffiliation.person_id == Person.id)
        .where(
            Person.user_id.is_not(None),
            PersonAffiliation.class_id.in_(class_ids),
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.status == PersonAffiliationStatus.ACTIVE,
            PersonAffiliation.start_date <= today,
            (PersonAffiliation.end_date.is_(None)) | (PersonAffiliation.end_date >= today),
        ),
        select(ClassManualMember.user_id).where(ClassManualMember.class_id.in_(class_ids)),
        select(ClassRosterEntry.user_id).where(
            ClassRosterEntry.class_id.in_(class_ids),
            ClassRosterEntry.user_id.is_not(None),
        ),
        select(User.id)
        .join(ClassRosterEntry, ClassRosterEntry.student_id == User.student_id)
        .where(
            ClassRosterEntry.class_id.in_(class_ids),
            User.student_id.is_not(None),
        ),
    )
    unassigned_orders = (
        select(Order)
        .options(selectinload(Order.user))
        .where(
            Order.class_id.is_(None),
            Order.test_product_id.is_(None),
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
        )
        .order_by(Order.id)
        .with_for_update(of=Order)
        .execution_options(populate_existing=True)
    )
    orders = list(
        (await session.scalars(unassigned_orders.where(Order.user_id.in_(member_user_ids)))).all()
    )

    range_result = await session.execute(
        select(ClassStudentRange.student_id_start, ClassStudentRange.student_id_end)
        .join(SchoolClass, SchoolClass.id == ClassStudentRange.class_id)
        .where(SchoolClass.id.in_(class_ids), SchoolClass.is_active.is_(True))
    )
    class_ranges = list(range_result.tuples())
    if class_ranges:
        range_orders = await session.scalars(
            unassigned_orders.join(Order.user).where(
                Order.user_id.not_in(member_user_ids),
                User.student_id.is_not(None),
            )
        )
        orders.extend(
            order
            for order in range_orders
            if order.user is not None
            and any(
                class_svc.student_id_in_range(order.user.student_id or "", start, end)
                for start, end in class_ranges
            )
        )

    classes_by_user: dict[uuid.UUID, SchoolClass | None] = {}
    for order in orders:
        if order.user_id not in classes_by_user:
            classes_by_user[order.user_id] = await class_svc.resolve_user_class(session, order.user)
        school_class = classes_by_user[order.user_id]
        if school_class is None or school_class.id not in class_ids:
            continue
        order.class_id = school_class.id
        order.school_class = school_class
        await receivable_svc.sync_shop_order(session, order)


async def class_order_summary(
    session: AsyncSession,
    *,
    class_ids: list[uuid.UUID],
    activity_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    general_only: bool = False,
    product_id: uuid.UUID | None = None,
    is_class_collected: bool | None = None,
    assistance_scope: str | None = None,
) -> ShopClassSummaryOut:
    orders: list[Order] = []
    while True:
        page = await list_orders(
            session,
            class_ids=class_ids,
            activity_id=activity_id,
            category_id=category_id,
            general_only=general_only,
            assistance_scope=assistance_scope,
            product_id=product_id,
            is_class_collected=is_class_collected,
            limit=500,
            offset=len(orders),
        )
        orders.extend(page)
        if len(page) < 500:
            break

    active_orders = [
        order
        for order in orders
        if order.status not in (OrderStatus.CANCELLED, OrderStatus.REFUNDED)
    ]
    product_totals: dict[uuid.UUID, ShopClassProductSummaryRow] = {}
    item_count = 0
    amount_by_order_id: dict[uuid.UUID, int] = {}
    for order in active_orders:
        order_amount = 0
        order_product_ids: set[uuid.UUID] = set()
        subtotal = order.subtotal_price or sum(
            item.quantity * item.unit_price for item in order.items
        )
        for item in order.items:
            if product_id and item.product_id != product_id:
                continue
            if category_id and not (
                item.product is not None
                and (
                    item.product.category_id == category_id
                    or (
                        item.product.series is not None
                        and item.product.series.category_id == category_id
                    )
                )
            ):
                continue
            quantity = item.quantity
            gross = item.quantity * item.unit_price
            amount = (
                max(0, gross - round(order.discount_amount * gross / subtotal)) if subtotal else 0
            )
            item_count += quantity
            order_amount += amount
            row = product_totals.get(item.product_id)
            if row is None:
                row = ShopClassProductSummaryRow(
                    product_id=item.product_id,
                    product_name=item.product.name if item.product else "未命名商品",
                    quantity=0,
                    total_amount=0,
                )
                product_totals[item.product_id] = row
            row.quantity += quantity
            row.total_amount += amount
            if order.is_class_collected:
                row.collected_quantity += quantity
                row.collected_amount += amount
                if item.product_id not in order_product_ids:
                    row.collected_order_count += 1
            else:
                row.uncollected_quantity += quantity
                row.uncollected_amount += amount
                if item.product_id not in order_product_ids:
                    row.uncollected_order_count += 1
            order_product_ids.add(item.product_id)
        amount_by_order_id[order.id] = (
            order_amount if product_id or category_id else order.total_price
        )
    paid_orders = [order for order in active_orders if order.is_class_collected]
    unpaid_orders = [order for order in active_orders if not order.is_class_collected]
    return ShopClassSummaryOut(
        class_count=len(set(class_ids)),
        order_count=len(active_orders),
        item_count=item_count,
        total_amount=sum(amount_by_order_id[order.id] for order in active_orders),
        paid_amount=sum(amount_by_order_id[order.id] for order in paid_orders),
        unpaid_amount=sum(amount_by_order_id[order.id] for order in unpaid_orders),
        paid_order_count=len(paid_orders),
        unpaid_order_count=len(unpaid_orders),
        assisted_order_count=sum(
            1 for order in active_orders if order.assistance_scope == "class_assisted"
        ),
        product_rows=sorted(
            product_totals.values(), key=lambda row: (-row.quantity, row.product_name)
        ),
    )


async def order_summary(
    session: AsyncSession,
    *,
    group_by: str,
    activity_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    grade: int | None = None,
    class_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    status: OrderStatus | None = None,
    is_paid: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> OrderSummaryOut:
    if group_by not in ("class", "grade", "user"):
        raise ValueError("group_by 必須為 class / grade / user")

    q = select(Order).options(
        selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.category),
        selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.series),
        selectinload(Order.school_class),
        selectinload(Order.user),
    )
    q = q.where(Order.test_product_id.is_(None))
    if status is not None:
        q = q.where(Order.status == status)
    else:
        q = q.where(Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED]))
    if activity_id is not None:
        q = q.where(Order.activity_id == activity_id)
    if product_id:
        q = q.where(Order.items.any(OrderItem.product_id == product_id))
    if category_id:
        q = q.where(Order.items.any(OrderItem.product.has(_product_category_filter(category_id))))
    if grade is not None:
        q = q.where(Order.school_class.has(grade=grade))
    if class_id:
        q = q.where(Order.class_id == class_id)
    if user_id:
        q = q.where(Order.user_id == user_id)
    if is_paid is not None:
        q = q.where(Order.is_paid.is_(is_paid))
    if date_from:
        q = q.where(Order.created_at >= date_from)
    if date_to:
        q = q.where(Order.created_at <= date_to)
    orders = (await session.execute(q)).scalars().unique().all()

    groups: dict[str, OrderSummaryRow] = {}
    class_sort_keys: dict[str, tuple[bool, int, str]] = {}
    for order in orders:
        if group_by == "class":
            key = str(order.class_id) if order.class_id else "none"
            school_class = order.school_class
            label = class_svc.class_display_label(school_class) or "未分班"
            class_sort_keys[key] = (
                school_class is None,
                -school_class.academic_year if school_class is not None else 0,
                school_class.class_code if school_class is not None else "",
            )
        elif group_by == "grade":
            sc = order.school_class
            key = str(sc.grade) if sc else "none"
            label = f"{sc.grade} 年級" if sc else "未分班"
        else:
            key = str(order.user_id)
            label = order.user.display_name if order.user else key

        row = groups.get(key)
        if row is None:
            row = OrderSummaryRow(
                key=key,
                label=label,
                order_count=0,
                item_count=0,
                total_amount=0,
                paid_amount=0,
                unpaid_amount=0,
            )
            groups[key] = row
        matched_items = [
            item
            for item in order.items
            if (product_id is None or item.product_id == product_id)
            and (
                category_id is None
                or (
                    item.product is not None
                    and (
                        item.product.category_id == category_id
                        or (
                            item.product.series is not None
                            and item.product.series.category_id == category_id
                        )
                    )
                )
            )
        ]
        if not matched_items and (product_id is not None or category_id is not None):
            continue
        item_count = sum(item.quantity for item in matched_items)
        if product_id is None and category_id is None:
            amount = order.total_price
        else:
            gross = sum(item.quantity * item.unit_price for item in matched_items)
            subtotal = order.subtotal_price or sum(
                item.quantity * item.unit_price for item in order.items
            )
            amount = (
                max(0, gross - round(order.discount_amount * gross / subtotal)) if subtotal else 0
            )
        row.order_count += 1
        row.item_count += item_count
        row.total_amount += amount
        if order.is_paid:
            row.paid_amount += amount
        else:
            row.unpaid_amount += amount

    if group_by == "class":
        rows = sorted(
            groups.values(),
            key=lambda row: class_sort_keys.get(row.key, (True, 0, "")),
        )
    else:
        rows = sorted(groups.values(), key=lambda row: row.label)
    return OrderSummaryOut(
        group_by=group_by,
        rows=rows,
        total_amount=sum(r.total_amount for r in rows),
        paid_amount=sum(r.paid_amount for r in rows),
        unpaid_amount=sum(r.unpaid_amount for r in rows),
    )


async def class_payment_report(session: AsyncSession) -> list[ClassPaymentReportItemOut]:
    """列出班聯目前確認收款的班級／活動及其有效已繳訂單金額。"""
    result = await session.execute(
        select(
            ShopClassPayment.class_id,
            SchoolClass,
            ShopClassPayment.activity_id,
            Activity.name,
            ShopClassPayment.confirmed_at,
            func.coalesce(func.sum(Order.total_price), 0),
            func.count(Order.id),
        )
        .join(SchoolClass, SchoolClass.id == ShopClassPayment.class_id)
        .outerjoin(Activity, Activity.id == ShopClassPayment.activity_id)
        .outerjoin(
            Order,
            and_(
                Order.class_id == ShopClassPayment.class_id,
                Order.activity_id.is_not_distinct_from(ShopClassPayment.activity_id),
                Order.test_product_id.is_(None),
                Order.is_paid.is_(True),
                Order.status.notin_((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
            ),
        )
        .where(
            ShopClassPayment.is_paid.is_(True),
            ShopClassPayment.confirmed_at.is_not(None),
        )
        .group_by(
            ShopClassPayment.id,
            ShopClassPayment.class_id,
            ShopClassPayment.activity_id,
            ShopClassPayment.confirmed_at,
            SchoolClass.id,
            SchoolClass.academic_year,
            SchoolClass.class_code,
            SchoolClass.grade,
            SchoolClass.label,
            Activity.id,
            Activity.name,
        )
        .order_by(
            ShopClassPayment.confirmed_at.desc(),
            SchoolClass.grade,
            SchoolClass.class_code,
        )
    )
    return [
        ClassPaymentReportItemOut(
            class_id=class_id,
            class_label=class_svc.class_display_label(school_class) or "未命名班級",
            grade=school_class.grade,
            activity_id=activity_id,
            activity_label=activity_name or "一般商品",
            confirmed_at=confirmed_at,
            amount=int(amount),
            order_count=int(order_count),
        )
        for (
            class_id,
            school_class,
            activity_id,
            activity_name,
            confirmed_at,
            amount,
            order_count,
        ) in result.all()
        if confirmed_at is not None
    ]


async def order_quantities(
    session: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    grade: int | None = None,
    class_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    is_paid: bool | None = None,
    status: OrderStatus | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[OrderQuantityRow]:
    """回傳各商品規格組合的訂購數量（用於採購彙總）。"""

    q = (
        select(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.category),
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
            selectinload(Order.school_class),
        )
        .where(
            Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED])
            if status is None
            else Order.status == status
        )
    )
    q = q.where(Order.test_product_id.is_(None))
    if grade is not None:
        q = q.where(Order.school_class.has(grade=grade))
    if activity_id is not None:
        q = q.where(Order.activity_id == activity_id)
    if class_id:
        q = q.where(Order.class_id == class_id)
    if is_paid is not None:
        q = q.where(Order.is_paid.is_(is_paid))
    if date_from:
        q = q.where(Order.created_at >= date_from)
    if date_to:
        q = q.where(Order.created_at <= date_to)
    if product_id:
        q = q.where(Order.items.any(OrderItem.product_id == product_id))
    if category_id:
        q = q.where(Order.items.any(OrderItem.product.has(_product_category_filter(category_id))))
    orders = (await session.execute(q)).scalars().unique().all()

    # 逐 item 展開 variant key
    tally: dict[tuple, dict] = {}
    for order in orders:
        for item in order.items:
            if product_id and item.product_id != product_id:
                continue
            p = item.product
            if p is None:
                continue
            if category_id and not (
                p.category_id == category_id
                or (p.series is not None and p.series.category_id == category_id)
            ):
                continue
            variant_key = (
                " / ".join(
                    f"{opt['group_name']}:{opt['value']}"
                    for opt in sorted(item.selected_options, key=lambda x: x.get("group_name", ""))
                )
                if item.selected_options
                else "—"
            )
            key = (item.product_id, variant_key)
            if key not in tally:
                series_name = p.series.name if p.series else ""
                tally[key] = {
                    "product_id": item.product_id,
                    "product_name": p.name,
                    "series_name": series_name,
                    "variant_key": variant_key,
                    "qty_total": 0,
                    "qty_paid": 0,
                }
            tally[key]["qty_total"] += item.quantity
            if order.is_paid:
                tally[key]["qty_paid"] += item.quantity

    return [OrderQuantityRow(**v) for v in sorted(tally.values(), key=lambda x: x["product_name"])]
