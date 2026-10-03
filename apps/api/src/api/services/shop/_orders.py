"""商品登記與訂單 CRUD / 序列化 / 統計"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import now_local
from api.core.config import settings
from api.models.shop import (
    Cart,
    CartItem,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductSeries,
    ProductStatus,
    ShopOrderClose,
    ShopOrderPromotion,
    ShopPromotion,
)
from api.models.user import User
from api.schemas.shop import (
    CartItemCreate,
    CartItemOut,
    CartOut,
    ClassOrderUpsert,
    CurrentRegistrationUpdate,
    OrderItemCreate,
    OrderItemOut,
    OrderListItem,
    OrderOut,
    OrderPromotionOut,
    OrderQuantityRow,
    OrderSummaryOut,
    OrderSummaryRow,
    ShopClassProductSummaryRow,
    ShopClassSummaryOut,
    ShopOrderCloseOut,
)
from api.services import receivable as receivable_svc
from api.services import school_class as class_svc
from api.services.shop._catalog import (
    generate_order_serial,
    get_product,
)
from api.services.shop._promotions import PromotionAllocation, resolve_promotions

logger = logging.getLogger(__name__)

_PAYMENT_METHODS = {"cash_on_pickup", "bank_transfer"}


class PurchaseLimitError(ValueError):
    """購買數量超過商品設定的每人上限。"""


def _promotion_product_subtotals(items: list[OrderItem]) -> dict[uuid.UUID, int]:
    totals: dict[uuid.UUID, int] = {}
    for item in items:
        totals[item.product_id] = totals.get(item.product_id, 0) + item.quantity * item.unit_price
    return totals


def _promotion_product_quantities(items: list[OrderItem]) -> dict[uuid.UUID, int]:
    quantities: dict[uuid.UUID, int] = {}
    for item in items:
        quantities[item.product_id] = quantities.get(item.product_id, 0) + item.quantity
    return quantities


async def _sync_order_promotions(
    session: AsyncSession,
    order: Order,
    allocations: tuple[PromotionAllocation, ...],
) -> None:
    existing_rows = list(order.applied_promotions or [])
    existing_by_id = {row.promotion_id: row for row in existing_rows}
    previous_ids = set(existing_by_id)
    if not previous_ids and order.promotion_id is not None:
        previous_ids.add(order.promotion_id)
    selected_ids = {row.promotion.id for row in allocations}

    for promotion_id in previous_ids - selected_ids:
        previous = await session.scalar(
            select(ShopPromotion).where(ShopPromotion.id == promotion_id).with_for_update()
        )
        if previous is not None:
            previous.used_count = max(0, previous.used_count - 1)
        existing = existing_by_id.get(promotion_id)
        if existing is not None:
            order.applied_promotions.remove(existing)
            await session.delete(existing)
    for allocation in allocations:
        if allocation.promotion.id not in previous_ids:
            allocation.promotion.used_count += 1
        existing = existing_by_id.get(allocation.promotion.id)
        if existing is not None:
            existing.discount_amount = allocation.discount_amount
        else:
            order.applied_promotions.append(
                ShopOrderPromotion(
                    promotion_id=allocation.promotion.id,
                    promotion=allocation.promotion,
                    discount_amount=allocation.discount_amount,
                )
            )
    primary = next((row.promotion for row in allocations if row.promotion.code), None)
    if primary is None and allocations:
        primary = allocations[0].promotion
    order.promotion_id = primary.id if primary is not None else None
    order.promotion_code = primary.code if primary is not None else None


async def _apply_order_promotion(
    session: AsyncSession,
    order: Order,
    *,
    code: str | None,
) -> None:
    product_subtotals = _promotion_product_subtotals(order.items)
    product_quantities = _promotion_product_quantities(order.items)
    current_ids = {row.promotion_id for row in (order.applied_promotions or [])}
    if order.promotion_id is not None:
        current_ids.add(order.promotion_id)
    result = await resolve_promotions(
        session,
        user_id=order.user_id,
        subtotal=order.subtotal_price,
        code=code,
        product_subtotals=product_subtotals,
        product_quantities=product_quantities,
        activity_id=_order_activity_id(order),
        current_promotion_ids=current_ids,
    )
    await _sync_order_promotions(session, order, result.allocations)
    order.discount_amount = result.discount_amount
    order.total_price = max(0, order.subtotal_price - result.discount_amount)


def _resolve_selected_options(product: Product, option_ids: list[uuid.UUID]) -> list[dict]:
    id_set = set(option_ids)
    valid_ids = {o.id for g in product.variant_groups for o in g.options}
    for oid in option_ids:
        if oid not in valid_ids:
            raise ValueError("包含此商品不存在的變體選項")

    snapshot: list[dict] = []
    for group in sorted(product.variant_groups, key=lambda g: g.sort_order):
        picked = [o for o in group.options if o.is_active and o.id in id_set]
        if len(picked) != 1:
            raise ValueError(f"變體「{group.name}」需選擇一個選項")
        option = picked[0]
        snapshot.append(
            {
                "group_id": str(group.id),
                "group_name": group.name,
                "option_id": str(option.id),
                "value": option.value,
                "price_delta": option.price_delta,
            }
        )
    return snapshot


def _options_signature(selected_options: list[dict]) -> str:
    return ",".join(sorted(str(o.get("option_id")) for o in selected_options))


def _options_delta(selected_options: list[dict]) -> int:
    return sum(int(o.get("price_delta", 0) or 0) for o in selected_options)


def _product_category_filter(category_id: uuid.UUID):
    return or_(
        Product.category_id == category_id,
        Product.series.has(ProductSeries.category_id == category_id),
    )


def _product_activity_id(product: Product) -> uuid.UUID | None:
    category = product.category
    if category is None and product.series is not None:
        category = product.series.category
    return category.activity_id if category is not None else None


async def _group_cart_items_by_activity(
    session: AsyncSession, cart_items: list[CartItem]
) -> dict[uuid.UUID | None, list[CartItem]]:
    groups: dict[uuid.UUID | None, list[CartItem]] = {}
    for cart_item in cart_items:
        product = await get_product(session, cart_item.product_id)
        if product is None:
            raise ValueError("購物車含已不存在的商品")
        groups.setdefault(_product_activity_id(product), []).append(cart_item)
    return groups


async def _purchased_quantity(
    session: AsyncSession,
    user_id: uuid.UUID,
    product_id: uuid.UUID,
    *,
    excluding_order_id: uuid.UUID | None = None,
) -> int:
    query = (
        select(func.coalesce(func.sum(OrderItem.quantity), 0))
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.user_id == user_id,
            Order.status.notin_((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
            OrderItem.product_id == product_id,
        )
    )
    if excluding_order_id is not None:
        query = query.where(Order.id != excluding_order_id)
    result = await session.execute(query)
    return int(result.scalar_one() or 0)


async def _assert_purchase_limit(
    session: AsyncSession,
    product: Product,
    user_id: uuid.UUID,
    requested_quantity: int,
    *,
    excluding_order_id: uuid.UUID | None = None,
) -> None:
    limit = product.max_quantity_per_user
    if limit is None:
        return
    purchased = await _purchased_quantity(
        session, user_id, product.id, excluding_order_id=excluding_order_id
    )
    remaining = max(0, limit - purchased)
    if requested_quantity > remaining:
        raise PurchaseLimitError(
            f"商品「{product.name}」每人限購 {limit} 件，已購買 {purchased} 件，"
            f"最多可登記 {remaining} 件，請調整數量"
        )


async def remaining_product_quantity(
    session: AsyncSession, product: Product, user_id: uuid.UUID | None
) -> int | None:
    limit = product.max_quantity_per_user
    if limit is None:
        return None
    if user_id is None:
        return limit

    purchased = await _purchased_quantity(session, user_id, product.id)
    return max(0, limit - purchased)


async def get_or_create_cart(session: AsyncSession, user_id: uuid.UUID) -> Cart:
    result = await session.execute(
        select(Cart)
        .options(selectinload(Cart.items).selectinload(CartItem.product))
        .where(Cart.user_id == user_id)
    )
    cart = result.scalar_one_or_none()
    if cart is None:
        cart = Cart(user_id=user_id)
        session.add(cart)
        await session.flush()
        await session.refresh(cart, attribute_names=["items"])
    return cart


async def add_cart_item(session: AsyncSession, user_id: uuid.UUID, *, data: CartItemCreate) -> Cart:
    cart = await get_or_create_cart(session, user_id)
    product = await get_product(session, data.product_id)
    if product is None:
        raise ValueError("找不到此商品")
    if product.status != ProductStatus.ACTIVE:
        raise ValueError(f"商品「{product.name}」不在上架狀態")

    cart_quantity = sum(item.quantity for item in cart.items if item.product_id == product.id)
    await _assert_purchase_limit(session, product, user_id, cart_quantity + data.quantity)

    selected = _resolve_selected_options(product, data.option_ids)
    signature = _options_signature(selected)

    for item in cart.items:
        if (
            item.product_id == product.id
            and _options_signature(item.selected_options or []) == signature
        ):
            item.quantity = min(item.quantity + data.quantity, 100)
            await session.flush()
            return cart

    cart.items.append(CartItem(product=product, quantity=data.quantity, selected_options=selected))
    await session.flush()
    return cart


async def update_cart_item(
    session: AsyncSession, user_id: uuid.UUID, item_id: uuid.UUID, *, quantity: int
) -> Cart:
    cart = await get_or_create_cart(session, user_id)
    target = next((i for i in cart.items if i.id == item_id), None)
    if target is None:
        raise ValueError("找不到購物車品項")
    product = target.product
    cart_quantity = sum(item.quantity for item in cart.items if item.product_id == product.id)
    await _assert_purchase_limit(
        session, product, user_id, cart_quantity - target.quantity + quantity
    )
    target.quantity = quantity
    await session.flush()
    return cart


async def remove_cart_item(session: AsyncSession, user_id: uuid.UUID, item_id: uuid.UUID) -> Cart:
    cart = await get_or_create_cart(session, user_id)
    target = next((i for i in cart.items if i.id == item_id), None)
    if target is not None:
        cart.items.remove(target)
        await session.flush()
    return cart


async def clear_cart(session: AsyncSession, user_id: uuid.UUID) -> Cart:
    cart = await get_or_create_cart(session, user_id)
    cart.items.clear()
    await session.flush()
    return await get_or_create_cart(session, user_id)


def _cart_item_availability(product: Product, quantity: int) -> tuple[bool, str | None]:
    now = datetime.now(UTC)
    if product.status != ProductStatus.ACTIVE:
        return False, "商品已下架"
    if product.sale_start and now < product.sale_start:
        return False, "尚未開售"
    if product.sale_end and now > product.sale_end:
        return False, "已截止販售"
    if not product.is_unlimited and product.stock_quantity < quantity:
        return False, f"庫存不足（剩餘 {product.stock_quantity} 件）"
    return True, None


def serialize_cart(cart: Cart) -> CartOut:
    items_out: list[CartItemOut] = []
    total = 0
    for item in cart.items:
        product = item.product
        unit_price = product.price + _options_delta(item.selected_options or [])
        subtotal = unit_price * item.quantity
        available, reason = _cart_item_availability(product, item.quantity)
        if available:
            total += subtotal
        items_out.append(
            CartItemOut(
                id=item.id,
                product_id=product.id,
                product_name=product.name,
                product_image_url=product.image_url,
                max_quantity_per_user=product.max_quantity_per_user,
                quantity=item.quantity,
                unit_price=unit_price,
                subtotal=subtotal,
                selected_options=item.selected_options or [],
                available=available,
                unavailable_reason=reason,
            )
        )
    return CartOut(id=cart.id, items=items_out, total_price=total)


async def _assert_activity_open(session: AsyncSession, product: Product) -> None:
    from api.models.activity import Activity, ActivityStatus

    category = getattr(product, "category", None)
    series = getattr(product, "series", None)
    if category is None and series is not None:
        category = getattr(series, "category", None)
    activity_id = getattr(category, "activity_id", None) if category else None
    if not activity_id:
        return
    activity = await session.get(Activity, activity_id)
    if activity is not None and activity.status in (
        ActivityStatus.ENDED,
        ActivityStatus.ARCHIVED,
    ):
        raise ValueError(f"商品「{product.name}」所屬活動已結束，停止販售")


def _order_activity_id(order: Order) -> uuid.UUID | None:
    if order.activity_id is not None:
        return order.activity_id
    activity_ids: set[uuid.UUID | None] = set()
    for item in getattr(order, "items", []) or []:
        product = getattr(item, "product", None)
        activity_ids.add(_product_activity_id(product) if product is not None else None)
    return next(iter(activity_ids)) if len(activity_ids) == 1 else None


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
    current_promotion_id: uuid.UUID | None = None,
    current_promotion_ids: set[uuid.UUID] | None = None,
    reserve_promotion_usage: bool = True,
) -> Order:
    subtotal_price = 0
    specs: list[dict] = []
    product_subtotals: dict[uuid.UUID, int] = {}
    product_quantities: dict[uuid.UUID, int] = {}
    now = datetime.now(UTC)

    locked_product_ids = sorted({ci.product_id for ci in cart_items})
    if locked_product_ids:
        await session.execute(
            select(Product.id)
            .where(Product.id.in_(locked_product_ids))
            .order_by(Product.id)
            .with_for_update()
        )

    requested_quantities: dict[uuid.UUID, int] = {}
    for cart_item in cart_items:
        requested_quantities[cart_item.product_id] = (
            requested_quantities.get(cart_item.product_id, 0) + cart_item.quantity
        )
    for product_id, quantity in requested_quantities.items():
        product = await get_product(session, product_id)
        if product is not None:
            await _assert_purchase_limit(session, product, user_id, quantity)

    for cart_item in cart_items:
        product = await get_product(session, cart_item.product_id)
        if product is None:
            raise ValueError("購物車含已不存在的商品")
        if _product_activity_id(product) != activity_id:
            raise ValueError("同一筆訂單只能包含同一活動的商品")
        if product.status != ProductStatus.ACTIVE:
            raise ValueError(f"商品「{product.name}」不在上架狀態")
        if product.sale_start and now < product.sale_start:
            raise ValueError(f"商品「{product.name}」尚未開售")
        if product.sale_end and now > product.sale_end:
            raise ValueError(f"商品「{product.name}」已截止販售")
        await _assert_activity_open(session, product)

        option_ids = [uuid.UUID(str(o["option_id"])) for o in (cart_item.selected_options or [])]
        selected = _resolve_selected_options(product, option_ids)
        unit_price = product.price + _options_delta(selected)

        if not product.is_unlimited:
            if product.stock_quantity < cart_item.quantity:
                raise ValueError(
                    f"商品「{product.name}」庫存不足（剩餘 {product.stock_quantity} 件）"
                )
            product.stock_quantity -= cart_item.quantity
            if product.stock_quantity == 0:
                product.status = ProductStatus.SOLD_OUT

        line_subtotal = unit_price * cart_item.quantity
        subtotal_price += line_subtotal
        product_subtotals[product.id] = product_subtotals.get(product.id, 0) + line_subtotal
        product_quantities[product.id] = product_quantities.get(product.id, 0) + cart_item.quantity
        specs.append(
            {
                "product_id": product.id,
                "quantity": cart_item.quantity,
                "unit_price": unit_price,
                "selected_options": selected,
            }
        )

    promotion_result = await resolve_promotions(
        session,
        user_id=user_id,
        subtotal=subtotal_price,
        code=coupon_code,
        product_subtotals=product_subtotals,
        product_quantities=product_quantities,
        activity_id=activity_id,
        current_promotion_ids=current_promotion_ids,
    )
    promotion = promotion_result.promotion
    if reserve_promotion_usage:
        for allocation in promotion_result.allocations:
            allocation.promotion.used_count += 1
    discount_amount = promotion_result.discount_amount
    total_price = max(0, subtotal_price - discount_amount)
    serial = await generate_order_serial(session)
    order = Order(
        serial_number=serial,
        user_id=user_id,
        activity_id=activity_id,
        class_id=class_id,
        assistance_scope=assistance_scope,
        assisted_by_id=assisted_by_id,
        status=OrderStatus.PENDING,
        subtotal_price=subtotal_price,
        discount_amount=discount_amount,
        total_price=total_price,
        promotion_id=promotion.id if promotion else None,
        promotion_code=promotion.code if promotion else None,
        applied_promotions=[
            ShopOrderPromotion(
                promotion_id=allocation.promotion.id,
                promotion=allocation.promotion,
                discount_amount=allocation.discount_amount,
            )
            for allocation in promotion_result.allocations
        ],
        payment_method=payment_method,
        notes=notes,
    )
    session.add(order)
    await session.flush()
    for spec in specs:
        session.add(OrderItem(order_id=order.id, **spec))
    await session.flush()
    logger.info("訂單建立 serial=%s total=%d", serial, total_price)
    return order


async def _order_items_to_cart_items(
    session: AsyncSession, items: list[OrderItemCreate]
) -> list[CartItem]:
    cart_items: list[CartItem] = []
    for item in items:
        product = await get_product(session, item.product_id)
        if product is None:
            raise ValueError("找不到此商品")
        selected = _resolve_selected_options(product, item.option_ids)
        cart_items.append(
            CartItem(
                product_id=item.product_id,
                quantity=item.quantity,
                selected_options=selected,
            )
        )
    return cart_items


async def create_direct_order(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    class_id: uuid.UUID | None,
    data: ClassOrderUpsert,
    assistance_scope: str = "class_assisted",
    assisted_by_id: uuid.UUID | None = None,
) -> list[Order]:
    cart_items = await _order_items_to_cart_items(session, data.items)
    orders: list[Order] = []
    for activity_id, activity_items in (
        await _group_cart_items_by_activity(session, cart_items)
    ).items():
        order = await _create_order_from_items(
            session,
            user_id=user_id,
            class_id=class_id,
            activity_id=activity_id,
            cart_items=activity_items,
            notes=data.notes,
            assistance_scope=assistance_scope,
            assisted_by_id=assisted_by_id,
        )
        await receivable_svc.sync_shop_order(session, order)
        orders.append(order)
    return orders


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
    if coupon_activity_id is not None and coupon_activity_id not in grouped_items:
        raise ValueError("優惠碼適用活動不在購物車中")
    orders: list[Order] = []
    for activity_id, activity_items in grouped_items.items():
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


def _validate_payment_method(payment_method: str | None) -> str:
    selected = payment_method or "cash_on_pickup"
    if selected not in _PAYMENT_METHODS:
        raise ValueError("不支援的付款方式")
    return selected


def _is_school_email(user) -> bool:
    email = (user.email or "").strip().lower()
    domain = email.rsplit("@", maxsplit=1)[-1] if "@" in email else ""
    return bool(user.student_id) or domain in {
        item.lower().lstrip("@") for item in settings.LOGIN_ALLOWED_EMAIL_DOMAINS
    }


async def get_current_registration(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    activity_id: uuid.UUID | None = None,
    match_activity: bool = False,
    lock: bool = False,
) -> Order | None:
    query = select(Order).where(
        Order.user_id == user_id,
        Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
    )
    if match_activity:
        query = query.where(
            Order.activity_id.is_(None) if activity_id is None else Order.activity_id == activity_id
        )
    query = query.order_by(Order.updated_at.desc(), Order.created_at.desc()).limit(1)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    result = await session.execute(query)
    order = result.scalars().first()
    return await get_order(session, order.id) if order else None


async def get_current_registrations(session: AsyncSession, user_id: uuid.UUID) -> list[Order]:
    result = await session.execute(
        select(Order.id)
        .where(
            Order.user_id == user_id,
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
        )
        .order_by(Order.created_at.desc(), Order.updated_at.desc())
    )
    orders: list[Order] = []
    for order_id in result.scalars().all():
        order = await get_order(session, order_id)
        if order is not None:
            orders.append(order)
    return orders


async def apply_registration_promotion(
    session: AsyncSession,
    user: User,
    *,
    code: str | None,
    activity_id: uuid.UUID | None = None,
) -> Order:
    order = await get_current_registration(
        session, user.id, activity_id=activity_id, match_activity=True, lock=True
    )
    if order is None or not order.items:
        raise ValueError("請先登記商品，再套用優惠")
    if order.is_paid or order.is_class_collected:
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")
    await _apply_order_promotion(session, order, code=code)
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    return order


async def _assert_product_registration_open(
    session: AsyncSession,
    product: Product,
    *,
    class_id: uuid.UUID | None,
    allow_sold_out: bool = False,
) -> None:
    if product.status != ProductStatus.ACTIVE and not (
        allow_sold_out and product.status == ProductStatus.SOLD_OUT
    ):
        raise ValueError(f"商品「{product.name}」目前無法登記")

    now = datetime.now(UTC)
    sale_start = product.sale_start
    sale_end = product.sale_end
    if sale_start is not None and sale_start.tzinfo is None:
        sale_start = sale_start.replace(tzinfo=UTC)
    if sale_end is not None and sale_end.tzinfo is None:
        sale_end = sale_end.replace(tzinfo=UTC)
    if sale_start and now < sale_start:
        raise ValueError(f"商品「{product.name}」尚未開放登記")
    if sale_end and now >= sale_end:
        raise ValueError(f"商品「{product.name}」已截止登記")
    await _assert_activity_open(session, product)

    category_id = product.category_id
    if category_id is None and product.series is not None:
        category_id = product.series.category_id
    if category_id is not None:
        closes = await get_close_status(session, [category_id], class_id)
        if closes.get(category_id) is not None:
            raise ValueError("您的班級已結單，無法修改商品登記，請聯繫班級幹部")


async def set_current_registration_product(
    session: AsyncSession,
    user: User,
    product_id: uuid.UUID,
    *,
    data: CurrentRegistrationUpdate,
) -> Order | None:
    """立即登記某商品的規格數量，並以目前有效訂單保存。"""
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

    activity_id = _product_activity_id(product)
    order = await get_current_registration(
        session, user.id, activity_id=activity_id, match_activity=True, lock=True
    )
    if order is not None:
        if order.is_paid or order.is_class_collected:
            raise ValueError("班級幹部已登記收款，商品登記已鎖定")
        if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
            raise ValueError("目前登記狀態無法修改")

    school_class = await class_svc.resolve_user_class(session, user)
    class_id = school_class.id if school_class else None
    if order is not None and order.class_id != class_id:
        raise ValueError("目前訂單的班級歸戶已變更，請聯繫班級幹部處理")

    existing_items = [
        item for item in (order.items if order is not None else []) if item.product_id == product.id
    ]
    existing_quantity = sum(item.quantity for item in existing_items)
    await _assert_product_registration_open(
        session,
        product,
        class_id=class_id,
        allow_sold_out=existing_quantity > 0,
    )

    variants: dict[str, tuple[int, list[dict]]] = {}
    for variant in data.variants:
        if len(set(variant.option_ids)) != len(variant.option_ids):
            raise ValueError("同一規格不能重複選擇選項")
        selected = _resolve_selected_options(product, variant.option_ids)
        signature = _options_signature(selected)
        if signature in variants:
            raise ValueError("相同規格不能重複登記")
        variants[signature] = (variant.quantity, selected)

    requested_total = sum(quantity for quantity, _ in variants.values())
    await _assert_purchase_limit(
        session,
        product,
        user.id,
        requested_total,
        excluding_order_id=order.id if order is not None else None,
    )

    if order is None and requested_total == 0:
        return None

    if not product.is_unlimited:
        quantity_delta = requested_total - existing_quantity
        if quantity_delta > product.stock_quantity:
            raise ValueError(f"商品「{product.name}」庫存不足（剩餘 {product.stock_quantity} 件）")
        product.stock_quantity -= quantity_delta
        if product.stock_quantity == 0:
            product.status = ProductStatus.SOLD_OUT
        elif product.status == ProductStatus.SOLD_OUT:
            product.status = ProductStatus.ACTIVE

    if order is None:
        order = Order(
            serial_number=await generate_order_serial(session),
            user_id=user.id,
            activity_id=activity_id,
            class_id=class_id,
            status=OrderStatus.PENDING,
            payment_method="school_collection" if _is_school_email(user) else "cash_on_pickup",
            subtotal_price=0,
            discount_amount=0,
            total_price=0,
            items=[],
            applied_promotions=[],
        )
        session.add(order)
        await session.flush()

    old_subtotal = order.subtotal_price
    existing_by_signature: dict[str, list[OrderItem]] = {}
    for item in existing_items:
        signature = _options_signature(item.selected_options or [])
        existing_by_signature.setdefault(signature, []).append(item)

    for signature, items in existing_by_signature.items():
        replacement = variants.get(signature)
        if replacement is None:
            for item in items:
                order.items.remove(item)
                await session.delete(item)
            continue

        quantity, selected = replacement
        keep, *duplicates = items
        keep.quantity = quantity
        keep.unit_price = product.price + _options_delta(selected)
        keep.selected_options = selected
        for item in duplicates:
            order.items.remove(item)
            await session.delete(item)

    for signature, (quantity, selected) in variants.items():
        if signature in existing_by_signature:
            continue
        order.items.append(
            OrderItem(
                product_id=product.id,
                quantity=quantity,
                unit_price=product.price + _options_delta(selected),
                selected_options=selected,
            )
        )

    await session.flush()
    subtotal = sum(item.quantity * item.unit_price for item in order.items)
    if not order.items:
        order.status = OrderStatus.CANCELLED
        order.subtotal_price = 0
        order.discount_amount = 0
        order.total_price = 0
        await _sync_order_promotions(session, order, ())
        await receivable_svc.cancel_for_source(session, "shop_order", order.id)
    else:
        order.subtotal_price = subtotal
        try:
            await _apply_order_promotion(session, order, code=order.promotion_code)
        except ValueError:
            # A coupon can stop matching after a user changes the registered products.
            await _apply_order_promotion(session, order, code=None)
        await receivable_svc.sync_shop_order(session, order)

    await session.flush()
    logger.info(
        "商品登記更新 serial=%s product=%s quantity=%d subtotal_before=%d",
        order.serial_number,
        product.id,
        requested_total,
        old_subtotal,
    )
    return order


async def get_order(session: AsyncSession, order_id: uuid.UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.category),
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
            selectinload(Order.applied_promotions).selectinload(ShopOrderPromotion.promotion),
            selectinload(Order.school_class),
            selectinload(Order.user),
        )
        .where(Order.id == order_id)
    )
    return result.scalar_one_or_none()


async def list_orders(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
    class_ids: list[uuid.UUID] | None = None,
    grade: int | None = None,
    assistance_scope: str | None = None,
    product_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    status: OrderStatus | None = None,
    is_paid: bool | None = None,
    is_class_collected: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    search: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Order]:
    q = (
        select(Order)
        .options(
            selectinload(Order.school_class),
            selectinload(Order.user),
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.category),
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
            selectinload(Order.applied_promotions).selectinload(ShopOrderPromotion.promotion),
        )
        .order_by(Order.created_at.desc())
    )
    if user_id:
        q = q.where(Order.user_id == user_id)
    if activity_id:
        q = q.where(Order.activity_id == activity_id)
    if class_ids is not None:
        if not class_ids:
            return []
        q = q.where(Order.class_id.in_(class_ids))
    if grade is not None:
        q = q.where(Order.school_class.has(grade=grade))
    if assistance_scope:
        q = q.where(Order.assistance_scope == assistance_scope)
    if product_id:
        q = q.where(Order.items.any(OrderItem.product_id == product_id))
    if category_id:
        q = q.where(Order.items.any(OrderItem.product.has(_product_category_filter(category_id))))
    if status:
        q = q.where(Order.status == status)
    if is_paid is not None:
        q = q.where(Order.is_paid.is_(is_paid))
    if is_class_collected is not None:
        q = q.where(Order.is_class_collected.is_(is_class_collected))
    if date_from:
        q = q.where(Order.created_at >= date_from)
    if date_to:
        q = q.where(Order.created_at <= date_to)
    if search:
        needle = f"%{search.strip()}%"
        q = q.where(
            or_(Order.serial_number.ilike(needle), Order.user.has(User.display_name.ilike(needle)))
        )
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


async def class_order_summary(
    session: AsyncSession,
    *,
    class_ids: list[uuid.UUID],
    product_id: uuid.UUID | None = None,
    is_class_collected: bool | None = None,
    assistance_scope: str | None = None,
) -> ShopClassSummaryOut:
    orders = await list_orders(
        session,
        class_ids=class_ids,
        assistance_scope=assistance_scope,
        product_id=product_id,
        is_class_collected=is_class_collected,
        limit=500,
    )
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
        amount_by_order_id[order.id] = order_amount if product_id else order.total_price
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


def serialize_order_item(item: OrderItem) -> OrderItemOut:
    return OrderItemOut(
        id=item.id,
        product_id=item.product_id,
        product_name=item.product.name if item.product else None,
        quantity=item.quantity,
        unit_price=item.unit_price,
        subtotal=item.quantity * item.unit_price,
        selected_options=item.selected_options or [],
    )


def serialize_order(order: Order) -> OrderOut:
    return OrderOut(
        id=order.id,
        serial_number=order.serial_number,
        user_id=order.user_id,
        activity_id=_order_activity_id(order),
        status=order.status,
        subtotal_price=order.subtotal_price,
        discount_amount=order.discount_amount,
        total_price=order.total_price,
        promotion_id=order.promotion_id,
        promotion_code=order.promotion_code,
        applied_promotions=[
            OrderPromotionOut(
                promotion_id=row.promotion_id,
                name=row.promotion.name if row.promotion else "優惠",
                code=row.promotion.code if row.promotion else None,
                discount_amount=row.discount_amount,
            )
            for row in order.applied_promotions
        ],
        payment_method=order.payment_method,
        notes=order.notes,
        class_id=order.class_id,
        class_label=class_svc.class_display_label(order.school_class),
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        is_paid=order.is_paid,
        is_class_collected=order.is_class_collected,
        class_collected_at=order.class_collected_at,
        paid_at=order.paid_at,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=[serialize_order_item(it) for it in order.items],
    )


def serialize_order_list_item(order: Order) -> OrderListItem:
    return OrderListItem(
        id=order.id,
        serial_number=order.serial_number,
        user_id=order.user_id,
        user_name=order.user.display_name if order.user else None,
        activity_id=_order_activity_id(order),
        status=order.status,
        subtotal_price=order.subtotal_price,
        discount_amount=order.discount_amount,
        total_price=order.total_price,
        promotion_code=order.promotion_code,
        payment_method=order.payment_method,
        class_id=order.class_id,
        class_label=class_svc.class_display_label(order.school_class),
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        is_paid=order.is_paid,
        is_class_collected=order.is_class_collected,
        created_at=order.created_at,
    )


async def cancel_order(
    session: AsyncSession,
    order: Order,
    *,
    requested_by: uuid.UUID,
    reason: str | None = None,
    bypass_owner_check: bool = False,
) -> Order:
    if not bypass_owner_check and order.user_id != requested_by:
        raise PermissionError("只有訂購人可取消訂單")
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法取消")
    if order.is_paid or order.is_class_collected:
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")
    for item in order.items:
        product = await get_product(session, item.product_id)
        if product is not None:
            await _assert_product_registration_open(
                session,
                product,
                class_id=order.class_id,
                allow_sold_out=True,
            )

    for item in order.items:
        product = await session.get(Product, item.product_id)
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


async def replace_order_items(
    session: AsyncSession,
    order: Order,
    *,
    data: ClassOrderUpsert,
) -> Order:
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法修改")
    if order.is_paid or order.is_class_collected:
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")

    activity_id = _order_activity_id(order)
    requested_activity_ids: set[uuid.UUID | None] = set()

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
        requested_activity_ids.add(_product_activity_id(product))
        await _assert_product_registration_open(
            session,
            product,
            class_id=order.class_id,
            allow_sold_out=any(existing.product_id == product.id for existing in order.items),
        )
    if len(requested_activity_ids) > 1 or (
        requested_activity_ids and next(iter(requested_activity_ids)) != activity_id
    ):
        raise ValueError("同一筆訂單只能包含原活動的商品")
    if order.activity_id is None:
        order.activity_id = activity_id

    for item in list(order.items):
        product = await session.get(Product, item.product_id)
        if product and not product.is_unlimited:
            product.stock_quantity += item.quantity
            if product.status == ProductStatus.SOLD_OUT:
                product.status = ProductStatus.ACTIVE
        await session.delete(item)
    await session.flush()

    temp_items = await _order_items_to_cart_items(session, data.items)
    specs_order = await _create_order_from_items(
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
        current_promotion_id=order.promotion_id,
        reserve_promotion_usage=False,
    )
    await _sync_order_promotions(
        session,
        order,
        tuple(
            PromotionAllocation(row.promotion, row.discount_amount)
            for row in specs_order.applied_promotions
            if row.promotion is not None
        ),
    )
    order.subtotal_price = specs_order.subtotal_price
    order.discount_amount = specs_order.discount_amount
    order.total_price = specs_order.total_price
    order.notes = data.notes
    temp_result = await session.execute(
        select(OrderItem).where(OrderItem.order_id == specs_order.id)
    )
    for item in temp_result.scalars().all():
        item.order_id = order.id
    await session.delete(specs_order)
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    return order


async def set_order_paid(
    session: AsyncSession, order: Order, *, is_paid: bool, actor_id: uuid.UUID
) -> Order:
    order.is_paid = is_paid
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


async def set_class_collected(
    session: AsyncSession, order: Order, *, collected: bool, actor_id: uuid.UUID
) -> Order:
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
) -> list[Order]:
    activity_filter = (
        Order.activity_id.is_(None) if activity_id is None else Order.activity_id == activity_id
    )
    orders = list(
        (
            await session.execute(
                select(Order)
                .where(
                    Order.class_id == class_id,
                    activity_filter,
                    Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED]),
                )
                .order_by(Order.id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    for order in orders:
        if order.is_paid != is_paid:
            await set_order_paid(session, order, is_paid=is_paid, actor_id=actor_id)
    return orders


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
    for order in orders:
        if group_by == "class":
            key = str(order.class_id) if order.class_id else "none"
            label = class_svc.class_display_label(order.school_class) or "未分班"
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

    rows = sorted(groups.values(), key=lambda r: r.label)
    return OrderSummaryOut(
        group_by=group_by,
        rows=rows,
        total_amount=sum(r.total_amount for r in rows),
        paid_amount=sum(r.paid_amount for r in rows),
        unpaid_amount=sum(r.unpaid_amount for r in rows),
    )


# ── 結單服務 ───────────────────────────────────────────────────────────────────


async def get_close_status(
    session: AsyncSession,
    category_ids: list[uuid.UUID],
    class_id: uuid.UUID | None,
) -> dict[uuid.UUID, ShopOrderCloseOut | None]:
    """回傳各 category 目前有效結單紀錄（or None）。
    若有 class_id，優先查班級結單；再查全局結單（class_id IS NULL）。
    """
    if not category_ids:
        return {}
    q = (
        select(ShopOrderClose)
        .options(selectinload(ShopOrderClose.closed_by))
        .where(
            ShopOrderClose.is_active.is_(True),
            ShopOrderClose.category_id.in_(category_ids),
            or_(
                ShopOrderClose.class_id == class_id,
                ShopOrderClose.class_id.is_(None),
            ),
        )
    )
    rows = (await session.execute(q)).scalars().all()
    result: dict[uuid.UUID, ShopOrderClose | None] = {cid: None for cid in category_ids}
    for row in rows:
        cid = row.category_id
        existing = result.get(cid)
        # 班級結單 > 全局結單（若兩者都有）
        if existing is None or row.class_id is not None:
            result[cid] = row
    return result


def _serialize_close(row: ShopOrderClose) -> ShopOrderCloseOut:
    closed_by_name = None
    if row.closed_by:
        closed_by_name = getattr(row.closed_by, "display_name", None) or str(row.closed_by_id)
    return ShopOrderCloseOut(
        id=row.id,
        category_id=row.category_id,
        class_id=row.class_id,
        closed_by_name=closed_by_name,
        closed_at=row.created_at,
        reopened_at=row.reopened_at,
        notes=row.notes,
        is_active=row.is_active,
    )


async def close_category_for_class(
    session: AsyncSession,
    *,
    category_id: uuid.UUID,
    class_id: uuid.UUID | None,
    closed_by_id: uuid.UUID,
    notes: str | None = None,
) -> ShopOrderClose:
    # 確認沒有重複有效結單
    existing_q = select(ShopOrderClose).where(
        ShopOrderClose.category_id == category_id,
        ShopOrderClose.is_active.is_(True),
        ShopOrderClose.class_id == class_id if class_id else ShopOrderClose.class_id.is_(None),
    )
    existing = (await session.execute(existing_q)).scalar_one_or_none()
    if existing:
        raise ValueError("此分類已結單，請先重新開單再結單")
    close = ShopOrderClose(
        category_id=category_id,
        class_id=class_id,
        closed_by_id=closed_by_id,
        notes=notes,
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
    existing_q = select(ShopOrderClose).where(
        ShopOrderClose.category_id == category_id,
        ShopOrderClose.is_active.is_(True),
        ShopOrderClose.class_id == class_id if class_id else ShopOrderClose.class_id.is_(None),
    )
    existing = (await session.execute(existing_q)).scalar_one_or_none()
    if not existing:
        raise ValueError("此分類目前未結單")
    existing.is_active = False
    existing.reopened_by_id = reopened_by_id
    existing.reopened_at = now_local()
    await session.flush()
    return existing


# ── 商品規格數量彙總 ────────────────────────────────────────────────────────────


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
