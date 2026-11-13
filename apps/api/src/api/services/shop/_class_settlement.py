"""班級代訂與收款調整。"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import now_local
from api.models.school_class import SchoolClass
from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ProductStatus,
    ShopOrderClose,
)
from api.models.shop_class_collection import ShopClassCollection
from api.models.shop_class_payment import ShopClassPayment
from api.models.user import User
from api.schemas.shop import CurrentRegistrationUpdate
from api.services import receivable as receivable_svc
from api.services.shop._catalog import generate_order_serial, get_product
from api.services.shop._orders import (
    _apply_order_promotion,
    _assert_buyer_eligible,
    _assert_product_registration_open,
    _assert_purchase_limit,
    _get_class_member_orders,
    _is_school_email,
    _lock_class_orders,
    _options_delta,
    _options_signature,
    _product_order_scope,
    _resolve_selected_options,
    _sync_order_promotions,
    set_order_paid,
)
from api.services.shop._purchase_rules import assert_product_purchase_allowed


async def _settle_registration_orders(session: AsyncSession, orders: Iterable[Order]) -> None:
    """數量異動後，以同一交易更新金額、優惠配置與應收款。"""
    await session.flush()
    for order in orders:
        order.subtotal_price = sum(item.quantity * item.unit_price for item in order.items)
        if not order.items:
            order.status = OrderStatus.CANCELLED
            order.subtotal_price = 0
            order.discount_amount = 0
            order.total_price = 0
            await _sync_order_promotions(session, order, ())
            await receivable_svc.cancel_for_source(session, "shop_order", order.id)
        else:
            try:
                await _apply_order_promotion(session, order, code=order.promotion_code)
            except ValueError:
                # 調整品項後原優惠可能已不適用，仍套用符合條件的自動優惠。
                await _apply_order_promotion(session, order, code=None)
            await receivable_svc.sync_shop_order(session, order)
    await session.flush()


async def set_class_member_product(
    session: AsyncSession,
    *,
    user: User,
    actor: User,
    class_id: uuid.UUID,
    class_ids: list[uuid.UUID],
    product_id: uuid.UUID,
    data: CurrentRegistrationUpdate,
) -> list[Order]:
    """按學生的商品總量，跨其有效訂購調整未鎖定品項。"""
    if class_id not in class_ids:
        raise PermissionError("無權修改此學生的商品登記")
    await _assert_buyer_eligible(session, user)

    await _lock_class_orders(session, class_id)
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    await session.execute(
        select(Product)
        .where(Product.id == product_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    product = await get_product(session, product_id)
    if product is None:
        raise ValueError("找不到此商品")

    orders = await _get_class_member_orders(session, user.id, class_ids, lock=True)
    product_lines = [
        (order, item) for order in orders for item in order.items if item.product_id == product.id
    ]
    existing_quantity = sum(item.quantity for _, item in product_lines)
    await _assert_product_registration_open(
        session,
        product,
        class_id=class_id,
        allow_sold_out=existing_quantity > 0,
    )

    locked_quantities: dict[str, int] = {}
    current_options: dict[str, list[dict]] = {}
    editable_lines: dict[str, list[tuple[Order, OrderItem]]] = {}
    for order, item in product_lines:
        signature = _options_signature(item.selected_options or [])
        current_options.setdefault(signature, item.selected_options or [])
        if (
            order.is_paid
            or order.is_class_collected
            or order.is_class_balance
            or order.received_amount > 0
            or order.assistance_scope == "council_gift"
        ):
            locked_quantities[signature] = locked_quantities.get(signature, 0) + item.quantity
        else:
            editable_lines.setdefault(signature, []).append((order, item))

    requested: dict[str, tuple[int, list[dict]]] = {}
    for variant in data.variants:
        if len(set(variant.option_ids)) != len(variant.option_ids):
            raise ValueError("同一規格不能重複選擇選項")
        signature = ",".join(sorted(str(option_id) for option_id in variant.option_ids))
        if signature in requested:
            raise ValueError("相同規格不能重複登記")
        selected = current_options.get(signature)
        if selected is None:
            selected = _resolve_selected_options(product, variant.option_ids)
        requested[signature] = (variant.quantity, selected)

    for signature, locked_quantity in locked_quantities.items():
        if requested.get(signature, (0, []))[0] < locked_quantity:
            raise ValueError("已收款、已鎖定或家人代訂的數量不能減少")

    requested_total = sum(quantity for quantity, _ in requested.values())
    quantity_delta = requested_total - existing_quantity
    if quantity_delta > 0:
        await assert_product_purchase_allowed(session, product, user)
        await _assert_purchase_limit(session, product, user.id, quantity_delta)
    if not product.is_unlimited:
        if quantity_delta > product.stock_quantity:
            raise ValueError(f"商品「{product.name}」庫存不足（剩餘 {product.stock_quantity} 件）")
        product.stock_quantity -= quantity_delta
        if product.stock_quantity == 0:
            product.status = ProductStatus.SOLD_OUT
        elif product.status == ProductStatus.SOLD_OUT:
            product.status = ProductStatus.ACTIVE

    affected_orders: dict[uuid.UUID, Order] = {}
    all_signatures = set(editable_lines) | set(locked_quantities) | set(requested)
    for signature in all_signatures:
        entries = editable_lines.get(signature, [])
        current_editable = sum(item.quantity for _, item in entries)
        desired_total, selected = requested.get(
            signature,
            (locked_quantities.get(signature, 0), current_options.get(signature, [])),
        )
        desired_editable = desired_total - locked_quantities.get(signature, 0)
        difference = desired_editable - current_editable

        if difference < 0:
            remaining = -difference
            for order, item in sorted(
                entries,
                key=lambda entry: (entry[0].created_at, str(entry[0].id)),
                reverse=True,
            ):
                reduction = min(remaining, item.quantity)
                item.quantity -= reduction
                remaining -= reduction
                affected_orders[order.id] = order
                if item.quantity == 0:
                    order.items.remove(item)
                    await session.delete(item)
                if remaining == 0:
                    break
        elif difference > 0:
            if entries:
                order, item = min(
                    entries,
                    key=lambda entry: (entry[0].created_at, str(entry[0].id)),
                )
                item.quantity += difference
                affected_orders[order.id] = order
            else:
                scope = _product_order_scope(product)
                order = next(
                    (
                        candidate
                        for candidate in orders
                        if not candidate.is_paid
                        and not candidate.is_class_collected
                        and not candidate.is_class_balance
                        and not candidate.received_amount
                        and candidate.assistance_scope != "council_gift"
                        and all(
                            item.product is not None and _product_order_scope(item.product) == scope
                            for item in candidate.items
                        )
                        and (
                            candidate.items
                            or (
                                candidate.activity_id == scope[0]
                                and candidate.category_id == scope[1]
                            )
                        )
                    ),
                    None,
                )
                if order is None:
                    order = Order(
                        serial_number=await generate_order_serial(session),
                        user_id=user.id,
                        activity_id=scope[0],
                        category_id=scope[1],
                        class_id=class_id,
                        status=OrderStatus.PENDING,
                        payment_method="school_collection"
                        if _is_school_email(user)
                        else "cash_on_pickup",
                        subtotal_price=0,
                        discount_amount=0,
                        total_price=0,
                        items=[],
                        applied_promotions=[],
                        assistance_scope="class_assisted",
                        assisted_by_id=actor.id,
                    )
                    session.add(order)
                    await session.flush()
                    orders.append(order)
                order.items.append(
                    OrderItem(
                        product_id=product.id,
                        quantity=difference,
                        unit_price=product.price + _options_delta(selected),
                        selected_options=selected,
                        ordered_by_id=actor.id,
                        ordered_by_name=actor.display_name,
                    )
                )
                affected_orders[order.id] = order

    for order in affected_orders.values():
        if order.class_id is None:
            order.class_id = class_id
            order.school_class = await session.get(SchoolClass, class_id)

    await _settle_registration_orders(session, affected_orders.values())
    return await _get_class_member_orders(session, user.id, class_ids)


async def set_class_collected(
    session: AsyncSession, order: Order, *, collected: bool, actor_id: uuid.UUID
) -> Order:
    if order.assistance_scope == "council_gift":
        raise ValueError("贈送訂單免付款，無須登記收款")
    order.is_class_collected = collected
    order.class_collected_at = datetime.now(UTC) if collected else None
    order.class_collected_by_id = actor_id if collected else None
    await session.flush()
    return order


async def set_class_paid(
    session: AsyncSession,
    class_id: uuid.UUID,
    *,
    is_paid: bool,
    actor_id: uuid.UUID,
    activity_id: uuid.UUID | None,
    category_id: uuid.UUID | None = None,
    received_amount: int | None = None,
    expected_unpaid_amount: int | None = None,
) -> list[Order]:
    if not is_paid and received_amount is not None:
        raise ValueError("撤銷收款時不可提供實收金額")
    if received_amount is not None and expected_unpaid_amount is None:
        raise ValueError("請重新核對班級待收金額")
    if category_id is not None:
        category = await session.get(ProductCategory, category_id)
        if category is None:
            raise ValueError("找不到此活動")
        if activity_id is not None or category.activity_id is not None:
            raise ValueError("此活動保留共用收款設定，請依完整範圍收款")
    await session.execute(
        select(SchoolClass.id).where(SchoolClass.id == class_id).with_for_update()
    )
    payment = await session.scalar(
        select(ShopClassPayment)
        .where(
            ShopClassPayment.class_id == class_id,
            ShopClassPayment.activity_id == activity_id,
        )
        .execution_options(populate_existing=True)
    )
    activity_filter = (
        Order.activity_id.is_(None) if activity_id is None else Order.activity_id == activity_id
    )
    scope_filters = [activity_filter]
    if category_id is not None:
        from api.services.shop._receipts import _receipt_order_scope

        scope_filters.append(_receipt_order_scope(None, category_id))
    orders = list(
        (
            await session.execute(
                select(Order)
                .where(
                    Order.class_id == class_id,
                    *scope_filters,
                    Order.assistance_scope != "council_gift",
                    Order.test_product_id.is_(None),
                    Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED]),
                )
                .order_by(Order.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    unpaid = sum(
        max(0, order.total_price - (order.total_price if order.is_paid else order.received_amount))
        for order in orders
    )
    if is_paid and expected_unpaid_amount is not None and unpaid != expected_unpaid_amount:
        raise ValueError("班級待收金額已變動，請重新載入後核對")
    if received_amount is not None and not 0 < received_amount <= unpaid:
        raise ValueError("本次實收金額必須大於零，且不可超過待收金額")
    if payment is None:
        payment = ShopClassPayment(class_id=class_id, activity_id=activity_id)
        session.add(payment)
    if category_id is None and payment.is_paid != is_paid:
        payment.is_paid = is_paid
        payment.confirmed_at = datetime.now(UTC) if is_paid else None
        payment.confirmed_by_id = actor_id if is_paid else None
    remaining = received_amount if received_amount is not None else unpaid
    from api.services.shop._collection_ledger import record_class_collection

    partial = is_paid and remaining < unpaid
    newly_paid_orders: list[Order] = []
    for order in orders:
        if is_paid and not order.is_paid:
            allocation = min(remaining, max(0, order.total_price - order.received_amount))
            remaining -= allocation
            if partial:
                # 尾款仍屬於整班，不分出學生個人的追加訂單。
                was_class_balance = order.is_class_balance
                order.is_class_balance = True
                order.supplement_class_id = class_id
                if not was_class_balance and order.received_amount:
                    record_class_collection(
                        session,
                        order,
                        amount=order.received_amount,
                        actor_id=order.paid_by_id,
                        collected_at=order.paid_at,
                    )
            if order.received_amount + allocation >= order.total_price:
                await set_order_paid(session, order, is_paid=True, actor_id=actor_id)
                newly_paid_orders.append(order)
            elif allocation:
                record_class_collection(session, order, amount=allocation, actor_id=actor_id)
                order.received_amount += allocation
                order.paid_at = datetime.now(UTC)
                order.paid_by_id = actor_id
                await receivable_svc.sync_shop_order(session, order)
        elif not is_paid:
            if order.is_class_balance:
                await session.execute(
                    delete(ShopClassCollection).where(ShopClassCollection.order_id == order.id)
                )
                order.is_class_balance = False
                order.supplement_class_id = None
            if order.is_paid or order.received_amount:
                await set_order_paid(session, order, is_paid=False, actor_id=actor_id)
    if category_id is not None:
        await session.flush()
        # 一般商品共用舊收款紀錄；是否鎖定各活動仍由實際已繳訂單判斷。
        # 撤銷一個活動不能清掉其他活動的收款確認。
        has_paid_orders = await session.scalar(
            select(Order.id)
            .where(
                Order.class_id == class_id,
                Order.activity_id.is_(None),
                Order.test_product_id.is_(None),
                (Order.is_paid.is_(True) | (Order.received_amount > 0)),
                Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED]),
            )
            .limit(1)
        )
        payment.is_paid = has_paid_orders is not None
        if is_paid and (newly_paid_orders or received_amount):
            payment.confirmed_at = datetime.now(UTC)
            payment.confirmed_by_id = actor_id
        elif not payment.is_paid:
            payment.confirmed_at = None
            payment.confirmed_by_id = None
        await session.flush()
    await session.flush()
    if newly_paid_orders and not partial:
        from api.services.shop._class_payment_notifications import (
            queue_class_payment_confirmation,
        )

        await queue_class_payment_confirmation(
            session,
            class_id=class_id,
            activity_id=activity_id,
            order_ids=[order.id for order in orders],
        )
    return orders


async def close_category_for_class(
    session: AsyncSession,
    *,
    category_id: uuid.UUID,
    class_id: uuid.UUID | None,
    closed_by_id: uuid.UUID,
    notes: str | None = None,
    closes_at: datetime | None = None,
) -> ShopOrderClose:
    # 同分類的截止設定互斥，避免重複的有效紀錄。
    category = await session.scalar(
        select(ProductCategory).where(ProductCategory.id == category_id).with_for_update()
    )
    if category is None:
        raise ValueError("找不到此商品分類")
    if class_id is None and closes_at is not None:
        raise ValueError("班聯統一截止時間請在活動設定調整")
    if class_id is not None and await session.get(SchoolClass, class_id) is None:
        raise ValueError("找不到此班級")
    now = datetime.now(UTC)
    # 確認沒有重複有效結單
    existing_q = select(ShopOrderClose).where(
        ShopOrderClose.category_id == category_id,
        ShopOrderClose.is_active.is_(True),
        ShopOrderClose.class_id == class_id if class_id else ShopOrderClose.class_id.is_(None),
    )
    existing = (await session.execute(existing_q)).scalar_one_or_none()
    if existing:
        scheduled = existing.closes_at
        if scheduled is not None and scheduled.tzinfo is None:
            scheduled = scheduled.replace(tzinfo=UTC)
        if class_id is None and (scheduled is None or scheduled <= now):
            raise ValueError("此分類已結單，請先重新開單再結單")
        existing.is_active = False
        existing.reopened_by_id = closed_by_id
        existing.reopened_at = now
    close = ShopOrderClose(
        category_id=category_id,
        class_id=class_id,
        closed_by_id=closed_by_id,
        notes=notes,
        closes_at=closes_at,
        is_active=True,
    )
    session.add(close)
    await session.flush()
    await session.refresh(close)
    return close


async def reopen_category_for_class(
    session: AsyncSession,
    *,
    category_id: uuid.UUID,
    class_id: uuid.UUID | None,
    reopened_by_id: uuid.UUID,
) -> ShopOrderClose:
    existing_q = (
        select(ShopOrderClose)
        .options(selectinload(ShopOrderClose.closed_by))
        .where(
            ShopOrderClose.category_id == category_id,
            ShopOrderClose.is_active.is_(True),
            ShopOrderClose.class_id == class_id if class_id else ShopOrderClose.class_id.is_(None),
        )
    )
    existing = (await session.execute(existing_q)).scalar_one_or_none()
    if not existing:
        raise ValueError("此分類目前未結單")
    existing.is_active = False
    existing.reopened_by_id = reopened_by_id
    existing.reopened_at = now_local()
    await session.flush()
    return existing


async def get_class_deadline(
    session: AsyncSession, category_id: uuid.UUID, class_id: uuid.UUID
) -> ShopOrderClose | None:
    return await session.scalar(
        select(ShopOrderClose)
        .where(
            ShopOrderClose.category_id == category_id,
            ShopOrderClose.class_id == class_id,
            ShopOrderClose.is_active.is_(True),
        )
        .options(selectinload(ShopOrderClose.closed_by))
    )
