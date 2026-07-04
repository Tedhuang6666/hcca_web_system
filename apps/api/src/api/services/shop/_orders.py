"""購物車 / 訂單 CRUD / 序列化 / 統計"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import now_local
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
)
from api.schemas.shop import (
    CartItemCreate,
    CartItemOut,
    CartOut,
    ClassOrderUpsert,
    CloseStatusItem,
    CloseStatusOut,
    OrderItemCreate,
    OrderItemOut,
    OrderListItem,
    OrderOut,
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

logger = logging.getLogger(__name__)


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

    series = getattr(product, "series", None)
    category = getattr(series, "category", None) if series else None
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
    for item in getattr(order, "items", []) or []:
        product = getattr(item, "product", None)
        series = getattr(product, "series", None) if product else None
        category = getattr(series, "category", None) if series else None
        if category and category.activity_id:
            return category.activity_id
    return None


async def _create_order_from_items(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    class_id: uuid.UUID | None,
    cart_items: list[CartItem],
    notes: str | None,
    assistance_scope: str = "self",
    assisted_by_id: uuid.UUID | None = None,
) -> Order:
    total_price = 0
    specs: list[dict] = []
    now = datetime.now(UTC)

    locked_product_ids = sorted({ci.product_id for ci in cart_items})
    if locked_product_ids:
        await session.execute(
            select(Product.id)
            .where(Product.id.in_(locked_product_ids))
            .order_by(Product.id)
            .with_for_update()
        )

    for cart_item in cart_items:
        product = await get_product(session, cart_item.product_id)
        if product is None:
            raise ValueError("購物車含已不存在的商品")
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

        total_price += unit_price * cart_item.quantity
        specs.append(
            {
                "product_id": product.id,
                "quantity": cart_item.quantity,
                "unit_price": unit_price,
                "selected_options": selected,
            }
        )

    serial = await generate_order_serial(session)
    order = Order(
        serial_number=serial,
        user_id=user_id,
        class_id=class_id,
        assistance_scope=assistance_scope,
        assisted_by_id=assisted_by_id,
        status=OrderStatus.PENDING,
        total_price=total_price,
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
    order = await _create_order_from_items(
        session,
        user_id=user_id,
        class_id=class_id,
        cart_items=cart_items,
        notes=data.notes,
        assistance_scope=assistance_scope,
        assisted_by_id=assisted_by_id,
    )
    await receivable_svc.sync_shop_order(session, order)
    return [order]


async def checkout(session: AsyncSession, user, *, notes: str | None = None) -> list[Order]:
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
            if p and p.series and p.series.category_id not in cat_ids:
                cat_ids.append(p.series.category_id)
        if cat_ids:
            close_map = await get_close_status(session, cat_ids, class_id)
            closed_cats = [str(cid) for cid, row in close_map.items() if row is not None]
            if closed_cats:
                raise ValueError("您的班級已結單，無法送出訂購，請聯繫班級幹部")

    order = await _create_order_from_items(
        session,
        user_id=user.id,
        class_id=class_id,
        cart_items=list(cart.items),
        notes=notes,
    )
    await receivable_svc.sync_shop_order(session, order)
    orders = [order]

    cart.items.clear()
    await session.flush()
    return orders


async def get_order(session: AsyncSession, order_id: uuid.UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
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
    status: OrderStatus | None = None,
    is_paid: bool | None = None,
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
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
        )
        .order_by(Order.created_at.desc())
    )
    if user_id:
        q = q.where(Order.user_id == user_id)
    if activity_id:
        q = q.where(
            Order.items.any(
                OrderItem.product.has(
                    Product.series.has(
                        ProductSeries.category.has(ProductCategory.activity_id == activity_id)
                    )
                )
            )
        )
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
    if status:
        q = q.where(Order.status == status)
    if is_paid is not None:
        q = q.where(Order.is_paid.is_(is_paid))
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


async def class_order_summary(
    session: AsyncSession,
    *,
    class_ids: list[uuid.UUID],
    product_id: uuid.UUID | None = None,
    is_paid: bool | None = None,
    assistance_scope: str | None = None,
) -> ShopClassSummaryOut:
    orders = await list_orders(
        session,
        class_ids=class_ids,
        assistance_scope=assistance_scope,
        product_id=product_id,
        is_paid=is_paid,
        limit=500,
    )
    active_orders = [order for order in orders if order.status != OrderStatus.CANCELLED]
    product_totals: dict[uuid.UUID, ShopClassProductSummaryRow] = {}
    item_count = 0
    amount_by_order_id: dict[uuid.UUID, int] = {}
    for order in active_orders:
        order_amount = 0
        for item in order.items:
            if product_id and item.product_id != product_id:
                continue
            quantity = item.quantity
            amount = item.quantity * item.unit_price
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
        amount_by_order_id[order.id] = order_amount if product_id else order.total_price
    paid_orders = [order for order in active_orders if order.is_paid]
    unpaid_orders = [order for order in active_orders if not order.is_paid]
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
        total_price=order.total_price,
        notes=order.notes,
        class_id=order.class_id,
        class_label=class_svc.class_display_label(order.school_class),
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        is_paid=order.is_paid,
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
        total_price=order.total_price,
        class_id=order.class_id,
        class_label=class_svc.class_display_label(order.school_class),
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        is_paid=order.is_paid,
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

    for item in order.items:
        product = await session.get(Product, item.product_id)
        if product and not product.is_unlimited:
            product.stock_quantity += item.quantity
            if product.status == ProductStatus.SOLD_OUT:
                product.status = ProductStatus.ACTIVE

    order.status = OrderStatus.CANCELLED
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
        cart_items=temp_items,
        notes=data.notes,
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
    )
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


async def order_summary(
    session: AsyncSession,
    *,
    group_by: str,
    product_id: uuid.UUID | None = None,
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
        selectinload(Order.items),
        selectinload(Order.school_class),
        selectinload(Order.user),
    )
    if status is not None:
        q = q.where(Order.status == status)
    else:
        q = q.where(Order.status != OrderStatus.CANCELLED)
    if product_id:
        q = q.where(Order.items.any(OrderItem.product_id == product_id))
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
            item for item in order.items if product_id is None or item.product_id == product_id
        ]
        if not matched_items:
            if product_id is None:
                amount = order.total_price
                item_count = 0
            else:
                continue
        else:
            amount = sum(item.quantity * item.unit_price for item in matched_items)
            item_count = sum(it.quantity for it in matched_items)
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
    q = select(ShopOrderClose).options(selectinload(ShopOrderClose.closed_by)).where(
        ShopOrderClose.is_active.is_(True),
        ShopOrderClose.category_id.in_(category_ids),
        or_(
            ShopOrderClose.class_id == class_id,
            ShopOrderClose.class_id.is_(None),
        ),
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
    grade: int | None = None,
    class_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    is_paid: bool | None = None,
    status: OrderStatus | None = None,
) -> list[OrderQuantityRow]:
    """回傳各商品規格組合的訂購數量（用於採購彙總）。"""
    from api.models.school_class import SchoolClass

    q = (
        select(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
            selectinload(Order.school_class),
        )
        .where(
            Order.status != OrderStatus.CANCELLED
            if status is None
            else Order.status == status
        )
    )
    if grade is not None:
        q = q.where(Order.school_class.has(grade=grade))
    if class_id:
        q = q.where(Order.class_id == class_id)
    if is_paid is not None:
        q = q.where(Order.is_paid.is_(is_paid))
    if product_id:
        q = q.where(Order.items.any(OrderItem.product_id == product_id))
    if category_id:
        q = q.where(
            Order.items.any(
                OrderItem.product.has(
                    Product.series.has(ProductSeries.category_id == category_id)
                )
            )
        )
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
            if category_id and (p.series is None or p.series.category_id != category_id):
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
