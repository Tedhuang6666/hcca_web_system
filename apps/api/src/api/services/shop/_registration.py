"""目前使用者的商品登記異動流程。"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductStatus,
    ShopDelegationLink,
)
from api.models.user import User
from api.schemas.shop import (
    CurrentRegistrationUpdate,
)
from api.services import school_class as class_svc
from api.services.shop._catalog import (
    generate_order_serial,
    get_product,
)
from api.services.shop._orders import (
    _assert_buyer_eligible,
    _assert_product_registration_open,
    _assert_purchase_limit,
    _is_school_email,
    _lock_class_orders,
    _options_delta,
    _options_signature,
    _product_order_scope,
    _resolve_selected_options,
    _settle_registration_orders,
    get_current_registration,
    get_current_registrations,
)
from api.services.shop._testing import can_test_products

logger = logging.getLogger("api.services.shop._orders")


async def set_current_registration_product(
    session: AsyncSession,
    user: User,
    product_id: uuid.UUID,
    *,
    data: CurrentRegistrationUpdate,
    actor: User | None = None,
    delegation: ShopDelegationLink | None = None,
) -> Order | None:
    """立即登記某商品的規格數量，並以目前有效訂單保存。"""
    school_class = await class_svc.resolve_user_class(session, user)
    await _lock_class_orders(session, school_class.id if school_class else None)
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

    testing = product.status == ProductStatus.TESTING
    actor = actor or user
    if testing:
        if (
            delegation is not None
            or actor.id != user.id
            or not await can_test_products(session, actor)
        ):
            raise PermissionError("需要權限：shop:test")
    else:
        await _assert_buyer_eligible(session, user)

    activity_id, category_id = _product_order_scope(product)
    order = await get_current_registration(
        session,
        user.id,
        activity_id=activity_id,
        category_id=category_id,
        match_activity=True,
        lock=True,
        reuse_cancelled=True,
        test_product_id=product.id if testing else None,
        editable_only=not testing and delegation is None,
    )
    if order is not None:
        if (order.is_paid or order.is_class_collected) and (testing or delegation is not None):
            raise ValueError("班級幹部已登記收款，商品登記已鎖定")
        if order.status not in (
            OrderStatus.PENDING,
            OrderStatus.CONFIRMED,
            OrderStatus.CANCELLED,
        ):
            raise ValueError("目前登記狀態無法修改")
        if any(
            _product_order_scope(item.product) != (activity_id, category_id) for item in order.items
        ):
            raise ValueError("這筆舊訂單包含多個活動，請聯繫班級幹部處理")

    school_class = await class_svc.resolve_user_class(session, user)
    class_id = school_class.id if school_class else None
    if order is not None and order.class_id != class_id:
        if order.class_id is None and school_class is not None:
            order.class_id = school_class.id
            order.school_class = school_class
        else:
            raise ValueError("目前訂單的班級歸戶已變更，請聯繫班級幹部處理")

    actor = actor or user
    source_id = delegation.id if delegation else None
    if delegation is not None and delegation.user_id != user.id:
        raise ValueError("代訂連結不屬於此學生")

    # 本人以規格總量加購；已收款品項保留原單，只將差額寫入未收款訂單。
    locked_quantities: dict[str, int] = {}
    if not testing and delegation is None:
        for existing_order in await get_current_registrations(session, user.id):
            if not existing_order.is_paid and not existing_order.is_class_collected:
                continue
            if any(item.product_id == product.id for item in existing_order.items) and any(
                _product_order_scope(item.product) != (activity_id, category_id)
                for item in existing_order.items
            ):
                raise ValueError("這筆舊訂單包含多個活動，請聯繫班級幹部處理")
            for item in existing_order.items:
                if item.product_id == product.id and item.delegation_link_id is None:
                    signature = _options_signature(item.selected_options or [])
                    locked_quantities[signature] = (
                        locked_quantities.get(signature, 0) + item.quantity
                    )
    cancelled = order is not None and order.status == OrderStatus.CANCELLED
    product_items = [
        item
        for item in (order.items if order is not None and not cancelled else [])
        if item.product_id == product.id
    ]
    existing_items = [item for item in product_items if item.delegation_link_id == source_id]
    other_quantity = sum(
        item.quantity for item in product_items if item.delegation_link_id != source_id
    )
    existing_quantity = sum(item.quantity for item in existing_items)
    await _assert_product_registration_open(
        session,
        product,
        class_id=class_id,
        allow_sold_out=existing_quantity + other_quantity > 0,
        allow_testing=testing,
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

    for signature, locked_quantity in locked_quantities.items():
        quantity, selected = variants.get(signature, (0, []))
        if quantity < locked_quantity:
            raise ValueError("已收款或鎖定的登記數量必須保留")
        if quantity == locked_quantity:
            variants.pop(signature, None)
        else:
            variants[signature] = (quantity - locked_quantity, selected)

    requested_total = sum(quantity for quantity, _ in variants.values())
    await _assert_purchase_limit(
        session,
        product,
        user.id,
        requested_total + other_quantity,
        excluding_order_id=order.id if order is not None else None,
    )

    if (order is None or cancelled) and requested_total == 0:
        return None

    if not product.is_unlimited:
        quantity_delta = requested_total - existing_quantity
        if quantity_delta > product.stock_quantity:
            raise ValueError(f"商品「{product.name}」庫存不足（剩餘 {product.stock_quantity} 件）")
        product.stock_quantity -= quantity_delta
        if product.stock_quantity == 0 and not testing:
            product.status = ProductStatus.SOLD_OUT
        elif product.status == ProductStatus.SOLD_OUT:
            product.status = ProductStatus.ACTIVE

    if order is None:
        order = Order(
            serial_number=await generate_order_serial(session),
            user_id=user.id,
            test_product_id=product.id if testing else None,
            activity_id=activity_id,
            category_id=category_id,
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
    elif cancelled:
        # 取消時庫存已歸還；重新登記只保留這次的品項，沿用原單與應收款。
        for item in list(order.items):
            order.items.remove(item)
            await session.delete(item)
        order.status = OrderStatus.PENDING

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
        if keep.ordered_by_id is None:
            keep.ordered_by_id = actor.id
            keep.ordered_by_name = actor.display_name
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
                ordered_by_id=actor.id,
                ordered_by_name=actor.display_name,
                delegation_link_id=source_id,
                delegation_name=delegation.name if delegation else None,
            )
        )

    await _settle_registration_orders(session, (order,))
    logger.info(
        "商品登記更新 serial=%s product=%s quantity=%d subtotal_before=%d",
        order.serial_number,
        product.id,
        requested_total,
        old_subtotal,
    )
    return order
