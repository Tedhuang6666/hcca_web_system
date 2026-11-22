"""建立、取消、修改與收款等訂單寫入流程。"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.outbox import OutboxEvent, OutboxStatus
from api.models.receivable import Receivable, ReceivableSource
from api.models.school_class import SchoolClass
from api.models.shop import (
    CartItem,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductStatus,
    ShopOrderPromotion,
    ShopPromotion,
)
from api.models.user import User
from api.schemas.shop import ClassOrderUpsert, OrderItemCreate
from api.services import receivable as receivable_svc
from api.services import school_class as class_svc
from api.services.shop import _teacher as teacher_svc
from api.services.shop._cart import get_or_create_cart
from api.services.shop._catalog import generate_order_serial, get_product
from api.services.shop._class_close_status import get_close_status
from api.services.shop._class_payment_scope import class_payment_for_scope
from api.services.shop._orders import (
    _apply_order_promotion,
    _assert_activity_order_unlocked,
    _assert_buyer_eligible,
    _assert_product_registration_open,
    _assert_purchase_limit,
    _is_school_email,
    _lock_class_orders,
    _options_delta,
    _options_signature,
    _order_activity_id,
    _order_category,
    _product_category_filter,
    _product_order_scope,
    _resolve_selected_options,
    _sync_order_promotions,
    _validate_payment_method,
    get_order,
)
from api.services.shop._payment_notifications import queue_individual_payment_notice
from api.services.shop._purchase_rules import (
    assert_group_purchase_limit,
    assert_product_purchase_allowed,
    product_purchase_restriction,
)
from api.services.shop._registration_queries import (
    get_current_registration,
    get_current_registrations,
)

logger = logging.getLogger("api.services.shop._orders")


async def _group_cart_items_by_activity(
    session: AsyncSession, cart_items: list[CartItem]
) -> dict[tuple[uuid.UUID | None, uuid.UUID | None], list[CartItem]]:
    groups: dict[tuple[uuid.UUID | None, uuid.UUID | None], list[CartItem]] = {}
    for cart_item in cart_items:
        product = await get_product(session, cart_item.product_id)
        if product is None:
            raise ValueError("購物車含已不存在的商品")
        groups.setdefault(_product_order_scope(product), []).append(cart_item)
    return groups


async def _create_order_from_items(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    class_id: uuid.UUID | None,
    activity_id: uuid.UUID | None,
    cart_items: list[CartItem],
    notes: str | None,
    assistance_scope: str = "self",
    assisted_by_id: uuid.UUID | None = None,
    coupon_code: str | None = None,
    payment_method: str = "cash_on_pickup",
    replace_order: Order | None = None,
    council_override: bool = False,
    supplement_class_id: uuid.UUID | None = None,
) -> Order:
    if replace_order is not None and replace_order.test_product_id is not None:
        raise ValueError("測試訂購請至商品頁調整")
    if replace_order is not None and replace_order.assistance_scope == "council_gift":
        raise ValueError("贈送訂單不可修改品項，請取消後重新贈送")
    gift = assistance_scope == "council_gift"
    await _lock_class_orders(session, class_id)
    # 與學生／家人即時登記共用使用者鎖，避免不同商品同時送出時各自建單。
    await session.execute(select(User.id).where(User.id == user_id).with_for_update())
    buyer = await session.get(User, user_id)
    if buyer is None:
        raise ValueError("找不到訂購人")
    await _assert_buyer_eligible(session, buyer)
    scopes = {
        _product_order_scope(product)
        for item in cart_items
        if (product := await get_product(session, item.product_id)) is not None
    }
    if len(scopes) != 1 or next(iter(scopes))[0] != activity_id:
        raise ValueError("同一筆訂單只能包含同一活動的商品")
    order_scope = next(iter(scopes))
    if assisted_by_id is not None and class_id is None and supplement_class_id is None:
        paid_orders = await get_current_registrations(session, user_id)
        if any(
            (existing.is_paid or existing.is_class_collected or existing.received_amount > 0)
            and _order_activity_id(existing) == activity_id
            and (
                activity_id is not None
                or any(_product_order_scope(item.product) == order_scope for item in existing.items)
            )
            for existing in paid_orders
        ):
            raise ValueError("已收款登記已鎖定，請先確認補收款原班級")
    order = replace_order
    if order is None and supplement_class_id is None and not gift:
        order = await get_current_registration(
            session,
            user_id,
            activity_id=activity_id,
            category_id=order_scope[1],
            match_activity=True,
            lock=True,
            reuse_cancelled=True,
            editable_only=True,
        )
    if order is not None:
        if (
            order.is_paid
            or order.is_class_collected
            or order.is_class_balance
            or order.received_amount > 0
        ):
            raise ValueError("班級幹部已登記收款，商品登記已鎖定")
        if order.class_id is not None and order.class_id != class_id:
            raise ValueError("目前訂單的班級歸戶已變更，請聯繫班級幹部處理")
        if any(_product_order_scope(item.product) != order_scope for item in order.items):
            raise ValueError("這筆舊訂單包含多個活動，請聯繫班級幹部處理")

    specs: list[dict] = []
    replacing = replace_order is not None
    cancelled = order is not None and order.status == OrderStatus.CANCELLED
    old_items = list(order.items) if order is not None else []
    locked_product_ids = sorted(
        {ci.product_id for ci in cart_items} | {item.product_id for item in old_items}
    )
    if locked_product_ids:
        await session.execute(
            select(Product)
            .where(Product.id.in_(locked_product_ids))
            .order_by(Product.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    if replacing:
        for item in old_items:
            product = await get_product(session, item.product_id)
            if product is not None and not product.is_unlimited:
                product.stock_quantity += item.quantity
                if product.status == ProductStatus.SOLD_OUT:
                    product.status = ProductStatus.ACTIVE

    requested_quantities: dict[uuid.UUID, int] = {}
    for cart_item in cart_items:
        requested_quantities[cart_item.product_id] = (
            requested_quantities.get(cart_item.product_id, 0) + cart_item.quantity
        )
    for product_id, quantity in requested_quantities.items():
        product = await get_product(session, product_id)
        if product is not None and not council_override:
            await _assert_purchase_limit(
                session,
                product,
                user_id,
                quantity,
                excluding_order_id=order.id if replacing else None,
                check_group=False,
            )

    await assert_group_purchase_limit(
        session,
        user_id,
        requested_quantities,
        excluding_order_id=order.id if replacing and order else None,
    )

    for cart_item in cart_items:
        product = await get_product(session, cart_item.product_id)
        if product is None:
            raise ValueError("購物車含已不存在的商品")
        await assert_product_purchase_allowed(session, product, buyer)
        product_scope = _product_order_scope(product)
        if product_scope != order_scope:
            raise ValueError("同一筆訂單只能包含同一活動的商品")
        sale_end = product.effective_sale_end
        if sale_end is not None and sale_end.tzinfo is None:
            sale_end = sale_end.replace(tzinfo=UTC)
        if not council_override and sale_end is not None and datetime.now(UTC) >= sale_end:
            raise ValueError(f"商品「{product.name}」已截止販售")
        if council_override:
            if product.status != ProductStatus.ACTIVE:
                raise ValueError(f"商品「{product.name}」目前無法登記")
        else:
            await _assert_product_registration_open(
                session, product, class_id=class_id, allow_class_deadline=assisted_by_id is not None
            )

        option_ids = [uuid.UUID(str(o["option_id"])) for o in (cart_item.selected_options or [])]
        selected = _resolve_selected_options(product, option_ids)
        unit_price = 0 if gift else product.price + _options_delta(selected)

        if not product.is_unlimited:
            if product.stock_quantity < cart_item.quantity:
                raise ValueError(
                    f"商品「{product.name}」庫存不足（剩餘 {product.stock_quantity} 件）"
                )
            product.stock_quantity -= cart_item.quantity
            if product.stock_quantity == 0:
                product.status = ProductStatus.SOLD_OUT

        specs.append(
            {
                "product_id": product.id,
                "quantity": cart_item.quantity,
                "unit_price": unit_price,
                "selected_options": selected,
            }
        )

    if order is None:
        order = Order(
            serial_number=await generate_order_serial(session),
            user_id=user_id,
            activity_id=activity_id,
            class_id=class_id,
            category_id=order_scope[1],
            assistance_scope=assistance_scope,
            assisted_by_id=assisted_by_id,
            supplement_class_id=supplement_class_id,
            status=OrderStatus.PENDING,
            subtotal_price=0,
            discount_amount=0,
            total_price=0,
            applied_promotions=[],
            items=[],
            payment_method=payment_method,
            notes=notes,
            **(await teacher_svc.buyer_snapshot(session, buyer)),
        )
        session.add(order)
        await session.flush()
    elif replacing or cancelled:
        for item in old_items:
            order.items.remove(item)
            await session.delete(item)
        order.status = OrderStatus.PENDING if cancelled else order.status
    order.class_id = class_id
    order.activity_id = activity_id
    order.category_id = order_scope[1]
    if notes is not None:
        order.notes = notes
    actor = await session.get(User, assisted_by_id or user_id)
    for spec in specs:
        existing = next(
            (
                item
                for item in order.items
                if item.product_id == spec["product_id"]
                and item.unit_price == spec["unit_price"]
                and _options_signature(item.selected_options)
                == _options_signature(spec["selected_options"])
                and item.delegation_link_id is None
                and item.ordered_by_id == (actor.id if actor else None)
            ),
            None,
        )
        if existing is not None:
            existing.quantity += spec["quantity"]
        else:
            order.items.append(
                OrderItem(
                    ordered_by_id=actor.id if actor else None,
                    ordered_by_name=actor.display_name if actor else None,
                    **spec,
                )
            )
    order.subtotal_price = sum(item.quantity * item.unit_price for item in order.items)
    await _apply_order_promotion(session, order, code=coupon_code or order.promotion_code)
    await session.flush()
    logger.info("商品登記更新 serial=%s total=%d", order.serial_number, order.total_price)
    return order


async def _order_items_to_cart_items(
    session: AsyncSession, items: list[OrderItemCreate]
) -> list[CartItem]:
    by_variant: dict[tuple[uuid.UUID, str], CartItem] = {}
    for item in items:
        product = await get_product(session, item.product_id)
        if product is None:
            raise ValueError("找不到此商品")
        selected = _resolve_selected_options(product, item.option_ids)
        key = (item.product_id, _options_signature(selected))
        if key in by_variant:
            by_variant[key].quantity += item.quantity
        else:
            by_variant[key] = CartItem(
                product_id=item.product_id,
                quantity=item.quantity,
                selected_options=selected,
            )
    return list(by_variant.values())


async def create_direct_order(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    class_id: uuid.UUID | None,
    data: ClassOrderUpsert,
    assistance_scope: str = "class_assisted",
    assisted_by_id: uuid.UUID | None = None,
    payment_method: str = "cash_on_pickup",
) -> list[Order]:
    await _lock_class_orders(session, class_id)
    gift = assistance_scope == "council_gift"
    if gift and (assisted_by_id is None or not (data.notes and data.notes.strip())):
        raise ValueError("贈送訂單必須保留操作人與贈送原因")
    council_override = assistance_scope in {"council_assisted", "council_separate", "council_gift"}
    cart_items = await _order_items_to_cart_items(session, data.items)
    orders: list[Order] = []
    for (activity_id, category_id), activity_items in (
        await _group_cart_items_by_activity(session, cart_items)
    ).items():
        supplement = assistance_scope == "council_separate"
        if council_override and not gift:
            categories = {
                product.category or (product.series.category if product.series else None)
                for item in activity_items
                if (product := await get_product(session, item.product_id)) is not None
            }
            closed = await get_close_status(
                session, [category.id for category in categories if category is not None], None
            )
            supplement = supplement or any(closed.values())
        if assisted_by_id is not None and class_id is not None and not gift:
            class_paid = await class_payment_for_scope(session, class_id, activity_id, category_id)
            collected = await session.scalar(
                select(Order.id)
                .where(
                    Order.user_id == user_id,
                    Order.class_id == class_id,
                    Order.activity_id == activity_id,
                    True
                    if activity_id is not None
                    else or_(
                        Order.category_id == category_id,
                        Order.category_id.is_(None)
                        & Order.items.any(
                            OrderItem.product.has(_product_category_filter(category_id))
                        ),
                    ),
                    Order.test_product_id.is_(None),
                    Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
                    or_(Order.is_paid.is_(True), Order.is_class_collected.is_(True)),
                )
                .limit(1)
            )
            supplement = supplement or class_paid is not None or collected is not None
        order = await _create_order_from_items(
            session,
            user_id=user_id,
            class_id=None if supplement else class_id,
            activity_id=activity_id,
            cart_items=activity_items,
            notes=data.notes,
            assistance_scope="supplement" if supplement else assistance_scope,
            assisted_by_id=assisted_by_id,
            payment_method=payment_method,
            council_override=council_override,
            supplement_class_id=class_id if supplement else None,
        )
        if gift:
            orders.append(order)
            continue
        receivable = await receivable_svc.sync_shop_order(session, order)
        if supplement:
            await queue_individual_payment_notice(
                session,
                order,
                reason="supplement_created",
                due_at=receivable.due_at if receivable else None,
            )
        orders.append(order)
    return orders


async def clear_all_orders(
    session: AsyncSession, *, order_ids: list[uuid.UUID] | None = None
) -> int:
    """清除商品訂單及其衍生資料，並回補訂單占用的庫存與優惠次數。"""
    clearing_tests = order_ids is not None
    if order_ids is None:
        # 一次清除全部時，不得連同已收款的訂單、應收款與班級收款帳一起硬刪；
        # 這些是金流紀錄，需先完成退款或個別處理。
        collected = await session.scalar(
            select(func.count())
            .select_from(Order)
            .where(
                Order.test_product_id.is_(None),
                or_(
                    Order.is_paid.is_(True),
                    Order.is_class_collected.is_(True),
                    Order.is_class_balance.is_(True),
                    Order.received_amount > 0,
                ),
            )
        )
        if collected:
            raise ValueError(f"仍有 {collected} 筆已收款訂單，不能一次清除全部訂購資料")
        order_ids = list((await session.scalars(select(Order.id))).all())
    if not order_ids:
        return 0

    active_quantities = await session.execute(
        select(OrderItem.product_id, func.sum(OrderItem.quantity))
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.id.in_(order_ids),
            Order.status.notin_((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
        )
        .group_by(OrderItem.product_id)
    )
    for product_id, quantity in active_quantities:
        product = await session.get(Product, product_id, with_for_update=True)
        if product is None or product.is_unlimited:
            continue
        product.stock_quantity += int(quantity or 0)
        if product.status == ProductStatus.SOLD_OUT and product.stock_quantity > 0:
            product.status = ProductStatus.ACTIVE

    promotion_usage = await session.execute(
        select(ShopOrderPromotion.promotion_id, func.count())
        .where(ShopOrderPromotion.order_id.in_(order_ids))
        .group_by(ShopOrderPromotion.promotion_id)
    )
    for promotion_id, usage_count in promotion_usage:
        promotion = await session.get(ShopPromotion, promotion_id, with_for_update=True)
        if promotion is not None:
            promotion.used_count = max(0, promotion.used_count - int(usage_count))

    order_id_strings = {str(order_id) for order_id in order_ids}
    confirmations_query = select(OutboxEvent).where(
        OutboxEvent.event_type.in_(
            ("shop.order_confirmed", "shop.order_payment_required", "realtime.room")
        )
    )
    if not clearing_tests:
        confirmations_query = confirmations_query.where(OutboxEvent.status == OutboxStatus.PENDING)
    pending_confirmations = await session.scalars(confirmations_query)
    for event in pending_confirmations:
        if (event.payload or {}).get("order_id") in order_id_strings:
            await session.delete(event)

    await session.execute(
        delete(Receivable).where(
            Receivable.source_type == ReceivableSource.SHOP_ORDER.value,
            Receivable.source_id.in_(order_ids),
        )
    )
    await session.execute(delete(Order).where(Order.id.in_(order_ids)))
    return len(order_ids)


async def checkout(
    session: AsyncSession,
    user,
    *,
    notes: str | None = None,
    coupon_code: str | None = None,
    coupon_activity_id: uuid.UUID | None = None,
    payment_method: str | None = None,
) -> list[Order]:
    cart = await get_or_create_cart(session, user.id)
    if not cart.items:
        raise ValueError("購物車是空的")

    school_class = await class_svc.resolve_user_class(session, user)
    class_id = school_class.id if school_class else None

    # 結單驗證：若學生班級已結單，拒絕送出
    if class_id is not None:
        cat_ids: list[uuid.UUID] = []
        for ci in cart.items:
            p = await get_product(session, ci.product_id)
            category_id = p.category_id if p else None
            if p and category_id is None and p.series:
                category_id = p.series.category_id
            if category_id and category_id not in cat_ids:
                cat_ids.append(category_id)
        if cat_ids:
            close_map = await get_close_status(session, cat_ids, class_id)
            closed_cats = [str(cid) for cid, row in close_map.items() if row is not None]
            if closed_cats:
                raise ValueError("您的班級已結單，無法送出訂購，請聯繫班級幹部")

    grouped_items = await _group_cart_items_by_activity(session, list(cart.items))
    if coupon_code and len(grouped_items) > 1 and coupon_activity_id is None:
        raise ValueError("購物車包含多個活動，請指定優惠碼適用的活動")
    if coupon_activity_id is not None and (coupon_activity_id, None) not in grouped_items:
        raise ValueError("優惠碼適用活動不在購物車中")
    orders: list[Order] = []
    for (activity_id, _category_id), activity_items in grouped_items.items():
        order = await _create_order_from_items(
            session,
            user_id=user.id,
            class_id=class_id,
            activity_id=activity_id,
            cart_items=activity_items,
            notes=notes,
            coupon_code=(
                coupon_code
                if coupon_code and (len(grouped_items) == 1 or activity_id == coupon_activity_id)
                else None
            ),
            payment_method=(
                "school_collection"
                if _is_school_email(user)
                else _validate_payment_method(payment_method)
            ),
        )
        await receivable_svc.sync_shop_order(session, order)
        orders.append(order)

    cart.items.clear()
    await session.flush()
    return orders


async def cancel_order(
    session: AsyncSession,
    order: Order,
    *,
    requested_by: uuid.UUID,
    reason: str | None = None,
    bypass_owner_check: bool = False,
    bypass_registration_window: bool = False,
) -> Order:
    await _lock_class_orders(session, order.class_id)
    await session.execute(select(User.id).where(User.id == order.user_id).with_for_update())
    await session.execute(
        select(Order)
        .where(Order.id == order.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    refreshed = await get_order(session, order.id)
    if refreshed is None:
        raise ValueError("找不到此訂單")
    order = refreshed
    if not bypass_owner_check and order.user_id != requested_by:
        raise PermissionError("只有訂購人可取消訂單")
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法取消")
    if (
        order.is_paid
        or order.is_class_collected
        or order.is_class_balance
        or order.received_amount > 0
    ):
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")
    if not bypass_registration_window:
        await _assert_activity_order_unlocked(session, _order_activity_id(order))
        for item in order.items:
            product = await get_product(session, item.product_id)
            if product is not None:
                await _assert_product_registration_open(
                    session,
                    product,
                    class_id=order.class_id,
                    allow_sold_out=True,
                    allow_testing=order.test_product_id is not None,
                )

    for item in order.items:
        product = await session.scalar(
            select(Product)
            .where(Product.id == item.product_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if product and not product.is_unlimited:
            product.stock_quantity += item.quantity
            if product.status == ProductStatus.SOLD_OUT:
                product.status = ProductStatus.ACTIVE

    order.status = OrderStatus.CANCELLED
    await _sync_order_promotions(session, order, ())
    if reason:
        order.notes = f"[取消原因] {reason}" + (f"\n{order.notes}" if order.notes else "")
    await receivable_svc.cancel_for_source(session, "shop_order", order.id)
    await session.flush()
    logger.info("訂單取消 serial=%s by=%s", order.serial_number, requested_by)
    return order


async def update_order_item_quantity(
    session: AsyncSession,
    order: Order,
    item_id: uuid.UUID,
    *,
    quantity: int,
    option_ids: list[uuid.UUID] | None = None,
) -> Order:
    await _lock_class_orders(session, order.class_id)
    await session.execute(select(User.id).where(User.id == order.user_id).with_for_update())
    await session.execute(
        select(Order)
        .where(Order.id == order.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    refreshed = await get_order(session, order.id)
    if refreshed is None:
        raise ValueError("找不到此訂單")
    order = refreshed
    if order.assistance_scope == "council_gift":
        raise ValueError("贈送訂單不可修改品項，請取消後重新贈送")
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法修改")
    if (
        order.is_paid
        or order.is_class_collected
        or order.is_class_balance
        or order.received_amount > 0
    ):
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")
    if order.test_product_id is not None:
        raise ValueError("測試訂購請至商品頁調整")

    item = next((row for row in order.items if row.id == item_id), None)
    if item is None:
        raise ValueError("找不到此品項")
    if quantity < 0 or quantity > 100:
        raise ValueError("訂購數量需介於 0 至 100 件")
    if quantity == 0 and len(order.items) == 1:
        raise ValueError("訂單至少需保留一項商品；如需取消整筆訂單，請取消訂單")

    product = await session.scalar(
        select(Product)
        .where(Product.id == item.product_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if product is None:
        raise ValueError("找不到此商品")

    selected = None
    if option_ids is not None and quantity > 0:
        if len(set(option_ids)) != len(option_ids):
            raise ValueError("同一規格不能重複選擇選項")
        full_product = await get_product(session, product.id)
        if full_product is None:
            raise ValueError("找不到此商品")
        selected = _resolve_selected_options(full_product, option_ids)

    delta = quantity - item.quantity
    if delta > 0:
        if order.assistance_scope == "sheet_import":
            await _assert_product_registration_open(session, product, class_id=None)
            if (
                await product_purchase_restriction(session, product, None)
                or product.max_quantity_per_user is not None
            ):
                raise ValueError("此商品有限購或身分限制，需人工確認")
        else:
            buyer = await session.get(User, order.user_id)
            if buyer is None:
                raise ValueError("找不到訂購人")
            await assert_product_purchase_allowed(session, product, buyer)
        if product.status not in (ProductStatus.ACTIVE, ProductStatus.SOLD_OUT):
            raise ValueError(f"商品「{product.name}」目前無法增加數量")
        if not product.is_unlimited and product.stock_quantity < delta:
            raise ValueError(f"商品「{product.name}」庫存不足（剩餘 {product.stock_quantity} 件）")
        product_quantity = sum(row.quantity for row in order.items if row.product_id == product.id)
        if order.user_id is not None:
            await _assert_purchase_limit(
                session,
                product,
                order.user_id,
                product_quantity + delta,
                excluding_order_id=order.id,
            )

    if delta and not product.is_unlimited:
        product.stock_quantity -= delta
        if product.stock_quantity == 0:
            product.status = ProductStatus.SOLD_OUT
        elif product.status == ProductStatus.SOLD_OUT:
            product.status = ProductStatus.ACTIVE

    if quantity == 0:
        order.items.remove(item)
        await session.delete(item)
    else:
        item.quantity = quantity
        if selected is not None:
            item.selected_options = selected
            item.unit_price = product.price + _options_delta(selected)

    order.subtotal_price = sum(row.quantity * row.unit_price for row in order.items)
    await _apply_order_promotion(session, order, code=order.promotion_code)
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    return order


async def replace_order_items(
    session: AsyncSession,
    order: Order,
    *,
    data: ClassOrderUpsert,
) -> Order:
    await _lock_class_orders(session, order.class_id)
    await session.execute(select(User.id).where(User.id == order.user_id).with_for_update())
    await session.execute(
        select(Order)
        .where(Order.id == order.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    refreshed = await get_order(session, order.id)
    if refreshed is None:
        raise ValueError("找不到此商品登記")
    order = refreshed
    if order.assistance_scope == "council_gift":
        raise ValueError("贈送訂單不可修改品項，請取消後重新贈送")
    if any(item.delegation_link_id is not None for item in order.items):
        raise ValueError("此訂單含家人代訂品項，請學生由商品頁或訂單明細逐項修改")
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法修改")
    if (
        order.is_paid
        or order.is_class_collected
        or order.is_class_balance
        or order.received_amount > 0
    ):
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")

    activity_id = _order_activity_id(order)
    category = _order_category(order)
    original_scope = (activity_id, category.id if category else None)
    requested_scopes: set[tuple[uuid.UUID | None, uuid.UUID | None]] = set()

    for item in order.items:
        product = await get_product(session, item.product_id)
        if product is not None:
            await _assert_product_registration_open(
                session,
                product,
                class_id=order.class_id,
                allow_sold_out=True,
            )
    for item in data.items:
        product = await get_product(session, item.product_id)
        if product is None:
            raise ValueError("找不到此商品")
        requested_scopes.add(_product_order_scope(product))
        await _assert_product_registration_open(
            session,
            product,
            class_id=order.class_id,
            allow_sold_out=any(existing.product_id == product.id for existing in order.items),
        )
    if len(requested_scopes) > 1 or (
        requested_scopes and order.items and next(iter(requested_scopes)) != original_scope
    ):
        raise ValueError("同一筆訂單只能包含原活動的商品")
    if order.activity_id is None:
        order.activity_id = activity_id
        order.category_id = category.id if category else None
    if not order.items and requested_scopes:
        activity_id, category_id = next(iter(requested_scopes))
        order.activity_id = activity_id
        order.category_id = category_id

    temp_items = await _order_items_to_cart_items(session, data.items)
    order = await _create_order_from_items(
        session,
        user_id=order.user_id,
        class_id=order.class_id,
        activity_id=activity_id,
        cart_items=temp_items,
        notes=data.notes,
        coupon_code=order.promotion_code,
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        payment_method=order.payment_method,
        replace_order=order,
    )
    order.notes = data.notes
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    return order


async def set_order_paid(
    session: AsyncSession, order: Order, *, is_paid: bool, actor_id: uuid.UUID
) -> Order:
    await _lock_class_orders(session, order.supplement_class_id or order.class_id)
    await session.execute(
        select(Order)
        .where(Order.id == order.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if order.assistance_scope == "council_gift":
        raise ValueError("贈送訂單免付款，無須登記收款")
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError("訂單已取消或退款，不能變更收款狀態")
    from api.services.shop._collection_ledger import record_class_collection

    record_class_collection(
        session,
        order,
        amount=(order.total_price if is_paid else 0) - order.received_amount,
        actor_id=actor_id,
    )
    if order.supplement_class_id is not None and not order.is_class_balance:
        await _lock_class_orders(session, order.supplement_class_id)
        order.class_id = order.supplement_class_id if is_paid else None
        order.school_class = (
            await session.get(SchoolClass, order.supplement_class_id) if is_paid else None
        )
    order.is_paid = is_paid
    order.received_amount = order.total_price if is_paid else 0
    if is_paid:
        order.paid_at = datetime.now(UTC)
        order.paid_by_id = actor_id
    else:
        order.paid_at = None
        order.paid_by_id = None
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    logger.info("訂單繳費狀態 serial=%s is_paid=%s by=%s", order.serial_number, is_paid, actor_id)
    return order


async def mark_order_refunded(session: AsyncSession, order_id: uuid.UUID) -> Order | None:
    """應收款全額退款後，把訂單轉為已退款並釋放優惠使用次數。

    庫存系統已退役，因此不回補庫存；收款金額由呼叫端（應收款退款）先行回寫。
    """
    await session.execute(select(Order.id).where(Order.id == order_id).with_for_update())
    order = await get_order(session, order_id)
    if order is None or order.status in (OrderStatus.CANCELLED, OrderStatus.REFUNDED):
        return order
    order.status = OrderStatus.REFUNDED
    await _sync_order_promotions(session, order, ())
    await session.flush()
    logger.info("訂單全額退款 serial=%s", order.serial_number)
    return order
