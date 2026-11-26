"""舊購物車 CRUD 與相容序列化。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import Cart, CartItem, Product, ProductSeries, ProductStatus
from api.models.user import User
from api.schemas.shop import CartItemCreate, CartItemOut, CartOut
from api.services.shop._catalog import get_product
from api.services.shop._orders import (
    _assert_purchase_limit,
    _options_delta,
    _options_signature,
    _purchased_quantity,
    _resolve_selected_options,
)
from api.services.shop._purchase_rules import (
    assert_group_purchase_limit,
    assert_product_purchase_allowed,
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
            selectinload(Cart.items).selectinload(CartItem.product).selectinload(Product.category),
            selectinload(Cart.items)
            .selectinload(CartItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
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
    buyer = await session.get(User, user_id)
    if buyer is None:
        raise ValueError("找不到訂購人")
    await assert_product_purchase_allowed(session, product, buyer)
    cart_quantities: dict[uuid.UUID, int] = {product.id: data.quantity}
    for item in cart.items:
        cart_quantities[item.product_id] = cart_quantities.get(item.product_id, 0) + item.quantity
    await assert_group_purchase_limit(session, user_id, cart_quantities)

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
    if quantity > target.quantity:
        cart_quantities: dict[uuid.UUID, int] = {}
        for item in cart.items:
            cart_quantities[item.product_id] = cart_quantities.get(item.product_id, 0) + (
                quantity if item.id == target.id else item.quantity
            )
        await assert_group_purchase_limit(session, user_id, cart_quantities)
    if quantity > target.quantity:
        buyer = await session.get(User, user_id)
        if buyer is None:
            raise ValueError("找不到訂購人")
        await assert_product_purchase_allowed(session, product, buyer)
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
