"""商品登記與訂單 CRUD / 序列化 / 統計"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings
from api.models.activity import Activity, ActivityStatus
from api.models.activity_link import ActivityLink, ActivityLinkKind
from api.models.outbox import OutboxEvent, OutboxStatus
from api.models.receivable import Receivable, ReceivableSource
from api.models.shop import (
    Cart,
    CartItem,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
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
    OrderItemCreate,
    ShopOrderCloseOut,
)
from api.services import receivable as receivable_svc
from api.services import school_class as class_svc
from api.services.electronic_credential import get_settings, identity_for_user
from api.services.shop._catalog import (
    generate_order_serial,
    get_product,
)
from api.services.shop._promotions import PromotionAllocation, resolve_promotions
from api.services.student_identity import has_student_identity

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


def _product_order_scope(product: Product) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    category = product.category
    if category is None and product.series is not None:
        category = product.series.category
    activity_id = category.activity_id if category is not None else None
    return activity_id, category.id if category is not None and activity_id is None else None


def _order_category(order: Order) -> ProductCategory | None:
    if _order_activity_id(order) is not None:
        return None
    category = order.__dict__.get("category")
    if category is not None:
        return category
    categories: dict[uuid.UUID | None, ProductCategory | None] = {}
    for item in order.items:
        product = item.product
        category = product.category if product else None
        if category is None and product and product.series:
            category = product.series.category
        categories[category.id if category else None] = category
    return next(iter(categories.values())) if len(categories) == 1 else None


def _product_activity_id(product: Product) -> uuid.UUID | None:
    category = product.category
    if category is None and product.series is not None:
        category = product.series.category
    return category.activity_id if category is not None else None


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
        .options(
            selectinload(Cart.items)
            .selectinload(CartItem.product)
            .selectinload(Product.category)
            .selectinload(ProductCategory.activity),
            selectinload(Cart.items)
            .selectinload(CartItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category)
            .selectinload(ProductCategory.activity),
        )
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
    category = product.category or (product.series.category if product.series else None)
    if category and category.activity and category.activity.order_closed_at:
        return False, "活動已結單，訂購已鎖定"
    if product.status != ProductStatus.ACTIVE:
        return False, "商品已下架"
    sale_start = product.sale_start
    sale_end = product.effective_sale_end
    if sale_start is not None and sale_start.tzinfo is None:
        sale_start = sale_start.replace(tzinfo=UTC)
    if sale_end is not None and sale_end.tzinfo is None:
        sale_end = sale_end.replace(tzinfo=UTC)
    if sale_start and now < sale_start:
        return False, "尚未開售"
    if sale_end and now >= sale_end:
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


async def _assert_activity_order_unlocked(
    session: AsyncSession, activity_id: uuid.UUID | None
) -> Activity | None:
    if not activity_id:
        return None
    # 與手動結單互斥；結單完成後的登記不可讀到 identity map 中的舊狀態。
    activity = await session.scalar(
        select(Activity)
        .where(Activity.id == activity_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    if activity is not None and activity.order_closed_at is not None:
        raise ValueError("活動已結單，訂購已鎖定；既有訂單仍可收款")
    return activity


async def _assert_activity_open(session: AsyncSession, product: Product) -> None:
    activity = await _assert_activity_order_unlocked(session, _product_activity_id(product))
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


async def _assert_buyer_eligible(session: AsyncSession, user: User) -> None:
    if await has_student_identity(session, user, current_only=True):
        return
    prefixes = (await get_settings(session)).student_id_prefixes
    identity = identity_for_user(user, student_id_prefixes=prefixes)
    if identity is not None and identity[0] == "teacher":
        return
    raise PermissionError("僅在校生與教師可自行訂購，其他帳號請使用學生提供的家長代訂連結")


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
    allow_class_closed: bool = False,
) -> Order:
    if replace_order is not None and replace_order.test_product_id is not None:
        raise ValueError("測試訂購請至商品頁調整")
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
    order = replace_order
    if order is None:
        order = await get_current_registration(
            session,
            user_id,
            activity_id=activity_id,
            category_id=order_scope[1],
            match_activity=True,
            lock=True,
            reuse_cancelled=True,
        )
    if order is not None:
        if order.is_paid or order.is_class_collected:
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
        if product is not None:
            await _assert_purchase_limit(
                session,
                product,
                user_id,
                quantity,
                excluding_order_id=order.id if replacing else None,
            )

    for cart_item in cart_items:
        product = await get_product(session, cart_item.product_id)
        if product is None:
            raise ValueError("購物車含已不存在的商品")
        product_scope = _product_order_scope(product)
        if product_scope != order_scope:
            raise ValueError("同一筆訂單只能包含同一活動的商品")
        sale_end = product.effective_sale_end
        if sale_end is not None and sale_end.tzinfo is None:
            sale_end = sale_end.replace(tzinfo=UTC)
        if sale_end is not None and datetime.now(UTC) >= sale_end:
            raise ValueError(f"商品「{product.name}」已截止販售")
        await _assert_product_registration_open(
            session,
            product,
            class_id=class_id,
            allow_class_closed=allow_class_closed,
        )

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
            status=OrderStatus.PENDING,
            subtotal_price=0,
            discount_amount=0,
            total_price=0,
            applied_promotions=[],
            items=[],
            payment_method=payment_method,
            notes=notes,
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
) -> list[Order]:
    cart_items = await _order_items_to_cart_items(session, data.items)
    orders: list[Order] = []
    for (activity_id, _category_id), activity_items in (
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
            allow_class_closed=assistance_scope == "class_assisted",
        )
        await receivable_svc.sync_shop_order(session, order)
        orders.append(order)
    return orders


async def clear_all_orders(
    session: AsyncSession, *, order_ids: list[uuid.UUID] | None = None
) -> int:
    """清除商品訂單及其衍生資料，並回補訂單占用的庫存與優惠次數。"""
    clearing_tests = order_ids is not None
    if order_ids is None:
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
        OutboxEvent.event_type == "shop.order_confirmed"
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
    await session.execute(
        delete(ActivityLink).where(
            ActivityLink.target_type == ActivityLinkKind.SHOP_ORDER.value,
            ActivityLink.target_id.in_(order_ids),
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
    category_id: uuid.UUID | None = None,
    lock: bool = False,
    reuse_cancelled: bool = False,
    test_product_id: uuid.UUID | None = None,
) -> Order | None:
    statuses = [OrderStatus.PENDING, OrderStatus.CONFIRMED]
    if reuse_cancelled:
        statuses.append(OrderStatus.CANCELLED)
    query = select(Order).where(
        Order.user_id == user_id,
        Order.status.in_(statuses),
        Order.test_product_id == test_product_id,
    )
    if match_activity:
        query = query.where(
            Order.activity_id.is_(None) if activity_id is None else Order.activity_id == activity_id
        )
    if match_activity and activity_id is None and category_id is not None:
        query = query.where(
            or_(
                Order.category_id == category_id,
                Order.category_id.is_(None)
                & Order.items.any(OrderItem.product.has(_product_category_filter(category_id))),
            )
        )
    query = query.order_by(
        (Order.status == OrderStatus.CANCELLED), Order.updated_at.desc(), Order.created_at.desc()
    ).limit(1)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    result = await session.execute(query)
    order = result.scalars().first()
    return await get_order(session, order.id) if order else None


async def get_current_registrations(
    session: AsyncSession, user_id: uuid.UUID, *, include_testing: bool = False
) -> list[Order]:
    result = await session.execute(
        select(Order.id)
        .where(
            Order.user_id == user_id,
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
            True if include_testing else Order.test_product_id.is_(None),
        )
        .order_by(Order.created_at.desc(), Order.updated_at.desc())
    )
    orders: list[Order] = []
    for order_id in result.scalars().all():
        order = await get_order(session, order_id)
        if order is not None:
            orders.append(order)
    return orders


async def _get_class_member_orders(
    session: AsyncSession,
    user_id: uuid.UUID,
    class_ids: list[uuid.UUID],
    *,
    lock: bool = False,
) -> list[Order]:
    query = (
        select(Order.id)
        .where(
            Order.user_id == user_id,
            Order.test_product_id.is_(None),
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
            or_(Order.class_id.in_(class_ids), Order.class_id.is_(None)),
        )
        .order_by(Order.created_at.desc(), Order.updated_at.desc())
    )
    if lock:
        query = query.with_for_update()
    result = await session.execute(query)
    orders: list[Order] = []
    for order_id in result.scalars().all():
        order = await get_order(session, order_id)
        if order is not None:
            orders.append(order)
    return orders


async def get_class_member_registrations(
    session: AsyncSession,
    user_id: uuid.UUID,
    class_ids: list[uuid.UUID],
) -> list[Order]:
    """取得班代有權管理的學生所有有效訂購。"""
    return await _get_class_member_orders(session, user_id, class_ids)


async def apply_registration_promotion(
    session: AsyncSession,
    user: User,
    *,
    code: str | None,
    activity_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
) -> Order:
    order = await get_current_registration(
        session,
        user.id,
        activity_id=activity_id,
        category_id=category_id,
        match_activity=True,
        lock=True,
    )
    if order is None or not order.items:
        raise ValueError("請先登記商品，再套用優惠")
    if order.is_paid or order.is_class_collected:
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")
    if category_id is not None and order.category_id != category_id:
        raise ValueError("這筆舊訂單包含多個活動，請聯繫班級幹部處理")
    await _assert_activity_order_unlocked(session, _order_activity_id(order))
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
    allow_testing: bool = False,
    allow_class_closed: bool = False,
) -> None:
    if allow_testing and product.status == ProductStatus.TESTING:
        await _assert_activity_order_unlocked(session, _product_activity_id(product))
        return
    await _assert_activity_open(session, product)
    if product.status != ProductStatus.ACTIVE and not (
        allow_sold_out and product.status == ProductStatus.SOLD_OUT
    ):
        raise ValueError(f"商品「{product.name}」目前無法登記")

    now = datetime.now(UTC)
    sale_start = product.sale_start
    sale_end = product.effective_sale_end
    if sale_start is not None and sale_start.tzinfo is None:
        sale_start = sale_start.replace(tzinfo=UTC)
    if sale_end is not None and sale_end.tzinfo is None:
        sale_end = sale_end.replace(tzinfo=UTC)
    if sale_start and now < sale_start:
        raise ValueError(f"商品「{product.name}」尚未開放登記")
    if sale_end and now >= sale_end:
        raise ValueError(f"商品「{product.name}」已截止登記")
    category_id = product.category_id
    if category_id is None and product.series is not None:
        category_id = product.series.category_id
    if category_id is not None:
        closes = await get_close_status(
            session, [category_id], None if allow_class_closed else class_id
        )
        if closes.get(category_id) is not None:
            if closes[category_id].class_id is None:
                raise ValueError("班聯會已全域停止此分類訂購，班代亦無法代訂")
            raise ValueError("您的班級已結單，無法修改商品登記，請聯繫班級幹部")


async def get_order(session: AsyncSession, order_id: uuid.UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .options(
            selectinload(Order.activity),
            selectinload(Order.category),
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
    general_only: bool = False,
    status: OrderStatus | None = None,
    is_paid: bool | None = None,
    is_class_collected: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    search: str | None = None,
    limit: int = 20,
    offset: int = 0,
    include_testing: bool = False,
) -> list[Order]:
    if class_ids is not None:
        if not class_ids:
            return []
        await _reconcile_unassigned_class_orders(session, class_ids)
    q = (
        select(Order)
        .options(
            selectinload(Order.activity),
            selectinload(Order.category),
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
        .order_by(Order.created_at.desc(), Order.id.desc())
    )
    if user_id:
        q = q.where(Order.user_id == user_id)
    if not include_testing:
        q = q.where(Order.test_product_id.is_(None))
    if activity_id:
        q = q.where(Order.activity_id == activity_id)
    if general_only:
        q = q.where(Order.activity_id.is_(None))
        if category_id is None:
            q = q.where(Order.category_id.is_(None))
    if class_ids is not None:
        q = q.where(Order.class_id.in_(class_ids))
    if grade is not None:
        q = q.where(Order.school_class.has(grade=grade))
    if assistance_scope:
        q = q.where(Order.assistance_scope == assistance_scope)
    if product_id:
        q = q.where(Order.items.any(OrderItem.product_id == product_id))
    if category_id:
        q = q.where(
            Order.category_id == category_id
            if general_only
            else Order.items.any(OrderItem.product.has(_product_category_filter(category_id)))
        )
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


async def cancel_order(
    session: AsyncSession,
    order: Order,
    *,
    requested_by: uuid.UUID,
    reason: str | None = None,
    bypass_owner_check: bool = False,
    bypass_registration_window: bool = False,
) -> Order:
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
    if order.is_paid or order.is_class_collected:
        raise ValueError("班級幹部已登記收款，商品登記已鎖定")
    await _assert_activity_order_unlocked(session, _order_activity_id(order))
    if not bypass_registration_window:
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


async def replace_order_items(
    session: AsyncSession,
    order: Order,
    *,
    data: ClassOrderUpsert,
    allow_class_closed: bool = False,
) -> Order:
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
    if any(item.delegation_link_id is not None for item in order.items):
        raise ValueError("此訂單含家人代訂品項，請學生由商品頁或訂單明細逐項修改")
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法修改")
    if order.is_paid or order.is_class_collected:
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
                allow_class_closed=allow_class_closed,
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
            allow_class_closed=allow_class_closed,
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
        allow_class_closed=allow_class_closed,
    )
    order.notes = data.notes
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


# ── 結單服務 ───────────────────────────────────────────────────────────────────


async def get_close_status(
    session: AsyncSession,
    category_ids: list[uuid.UUID],
    class_id: uuid.UUID | None,
    *,
    include_scheduled: bool = False,
) -> dict[uuid.UUID, ShopOrderClose | None]:
    """回傳各 category 目前有效結單紀錄（or None）。
    全局結單優先於班級結單；預約紀錄只在時間到後生效。
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
    if not include_scheduled:
        q = q.where(
            or_(ShopOrderClose.closes_at.is_(None), ShopOrderClose.closes_at <= datetime.now(UTC))
        )
    rows = (await session.execute(q)).scalars().all()
    result: dict[uuid.UUID, ShopOrderClose | None] = {cid: None for cid in category_ids}
    for row in rows:
        cid = row.category_id
        existing = result.get(cid)
        if existing is None or row.class_id is None:
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
        closes_at=row.closes_at,
        reopened_at=row.reopened_at,
        notes=row.notes,
        is_active=row.is_active,
    )


from api.services.shop._class_settlement import (  # noqa: E402
    _settle_registration_orders as _settle_registration_orders,
)
from api.services.shop._class_settlement import (  # noqa: E402
    close_category_for_class as close_category_for_class,
)
from api.services.shop._class_settlement import (  # noqa: E402
    reopen_category_for_class as reopen_category_for_class,
)
from api.services.shop._class_settlement import (  # noqa: E402
    set_class_collected as set_class_collected,
)
from api.services.shop._class_settlement import (  # noqa: E402
    set_class_member_product as set_class_member_product,
)
from api.services.shop._class_settlement import (  # noqa: E402
    set_class_paid as set_class_paid,
)
from api.services.shop._order_queries import (  # noqa: E402
    _reconcile_unassigned_class_orders as _reconcile_unassigned_class_orders,
)
from api.services.shop._order_queries import (  # noqa: E402
    class_order_summary as class_order_summary,
)
from api.services.shop._order_queries import (  # noqa: E402
    order_quantities as order_quantities,
)
from api.services.shop._order_queries import (  # noqa: E402
    order_summary as order_summary,
)
from api.services.shop._order_serialization import (  # noqa: E402
    serialize_order as serialize_order,
)
from api.services.shop._order_serialization import (  # noqa: E402
    serialize_order_item as serialize_order_item,
)
from api.services.shop._order_serialization import (  # noqa: E402
    serialize_order_list_item as serialize_order_list_item,
)
from api.services.shop._registration import (  # noqa: E402
    set_current_registration_product as set_current_registration_product,
)
