"""訂單共用規則、狀態檢查與查詢。"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings
from api.models.school_class import SchoolClass
from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ProductSeries,
    ProductStatus,
    ShopOrderPromotion,
    ShopPromotion,
)
from api.models.user import User
from api.services.electronic_credential import get_settings, identity_for_user
from api.services.shop._class_close_status import get_close_status
from api.services.shop._class_payment_scope import class_payment_for_scope
from api.services.shop._promotions import PromotionAllocation, resolve_promotions
from api.services.shop._purchase_rules import assert_group_purchase_limit
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
    from api.services.shop._gift_allocations import snapshot_order_gifts

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
    await snapshot_order_gifts(session, order, allocations)


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
                "original_price_delta": option.original_price_delta,
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


def _product_order_scope(product: Product) -> uuid.UUID | None:
    category = product.category
    if category is None and product.series is not None:
        category = product.series.category
    return category.id if category is not None else None


def _order_category(order: Order) -> ProductCategory | None:
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


def _product_category_id(product: Product) -> uuid.UUID | None:
    category = product.category
    if category is None and product.series is not None:
        category = product.series.category
    return category.id if category is not None else None


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
    check_group: bool = True,
) -> None:
    if check_group:
        await assert_group_purchase_limit(
            session,
            user_id,
            {product.id: requested_quantity},
            excluding_order_id=excluding_order_id,
            excluding_product_id=product.id,
        )
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


def _order_category_id(order: Order) -> uuid.UUID | None:
    if order.category_id is not None:
        return order.category_id
    category_ids = {
        _product_category_id(item.product)
        for item in (getattr(order, "items", []) or [])
        if item.product is not None
    }
    return next(iter(category_ids)) if len(category_ids) == 1 else None


async def _assert_buyer_eligible(session: AsyncSession, user: User) -> None:
    if await has_student_identity(session, user, current_only=True):
        return
    prefixes = (await get_settings(session)).student_id_prefixes
    identity = identity_for_user(user, student_id_prefixes=prefixes)
    if identity is not None and identity[0] == "teacher":
        return
    raise PermissionError("僅在校生與教師可自行訂購，其他帳號請使用學生提供的家長代訂連結")


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


async def _assert_product_registration_open(
    session: AsyncSession,
    product: Product,
    *,
    class_id: uuid.UUID | None,
    allow_sold_out: bool = False,
    allow_testing: bool = False,
    allow_class_deadline: bool = False,
) -> None:
    if allow_testing and product.status == ProductStatus.TESTING:
        return
    await _assert_class_order_unlocked(session, class_id)
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
        closes = await get_close_status(session, [category_id], class_id)
        if closes.get(category_id) is not None:
            if closes[category_id].is_global:
                raise ValueError("班聯會已全域停止此分類訂購，班代亦無法代訂")
            if not allow_class_deadline:
                raise ValueError("本班已截止，請聯繫班代協助加購")


def _order_detail_query() -> Select[tuple[Order]]:
    """單筆與批次訂單共用預載入關聯，避免列表逐筆呼叫 get_order。"""
    return select(Order).options(
        selectinload(Order.category),
        selectinload(Order.items).selectinload(OrderItem.product).selectinload(Product.category),
        selectinload(Order.items)
        .selectinload(OrderItem.product)
        .selectinload(Product.series)
        .selectinload(ProductSeries.category),
        selectinload(Order.applied_promotions).selectinload(ShopOrderPromotion.promotion),
        selectinload(Order.school_class),
        selectinload(Order.user),
    )


async def get_order(session: AsyncSession, order_id: uuid.UUID) -> Order | None:
    result = await session.execute(_order_detail_query().where(Order.id == order_id))
    return result.scalar_one_or_none()


async def list_orders(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
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
        from api.services.shop._order_queries import _reconcile_unassigned_class_orders

        await _reconcile_unassigned_class_orders(session, class_ids)
    q = (
        select(Order)
        .options(
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
    if general_only and category_id is None:
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


# ── 班級訂購鎖 ─────────────────────────────────────────────────────────────────


async def _lock_class_orders(session: AsyncSession, class_id: uuid.UUID | None) -> None:
    if class_id is not None:
        await session.execute(
            select(SchoolClass.id).where(SchoolClass.id == class_id).with_for_update(read=True)
        )


async def _assert_class_order_unlocked(
    session: AsyncSession,
    class_id: uuid.UUID | None,
) -> None:
    if class_id is None:
        return
    # 收款確認取排他鎖，登記取共享鎖，避免確認完成後仍有新單寫入。
    await session.execute(
        select(SchoolClass.id).where(SchoolClass.id == class_id).with_for_update(read=True)
    )
    payment = await class_payment_for_scope(session, class_id)
    if payment is not None:
        raise ValueError("班聯已確認本班收款，商品登記已鎖定")


_MOVED_SYMBOLS = {
    "generate_order_serial": "_catalog",
    "_cart_item_availability": "_cart",
    "add_cart_item": "_cart",
    "clear_cart": "_cart",
    "get_or_create_cart": "_cart",
    "remaining_product_quantity": "_cart",
    "remove_cart_item": "_cart",
    "serialize_cart": "_cart",
    "update_cart_item": "_cart",
    "_create_order_from_items": "_order_writes",
    "_group_cart_items_by_category": "_order_writes",
    "_order_items_to_cart_items": "_order_writes",
    "cancel_order": "_order_writes",
    "checkout": "_order_writes",
    "clear_all_orders": "_order_writes",
    "create_direct_order": "_order_writes",
    "mark_order_refunded": "_order_writes",
    "replace_order_items": "_order_writes",
    "set_order_paid": "_order_writes",
    "update_order_item_quantity": "_order_writes",
    "_get_class_member_orders": "_registration_queries",
    "apply_registration_promotion": "_registration_queries",
    "get_class_member_registrations": "_registration_queries",
    "get_current_registration": "_registration_queries",
    "get_current_registrations": "_registration_queries",
    "CloseStatusCollectionDetails": "_class_close_status",
    "_serialize_close": "_class_close_status",
    "get_close_status_collection_details": "_class_close_status",
    "_reconcile_unassigned_class_orders": "_order_queries",
    "class_order_summary": "_order_queries",
    "class_payment_report": "_order_queries",
    "order_quantities": "_order_queries",
    "order_summary": "_order_queries",
    "serialize_order": "_order_serialization",
    "serialize_order_item": "_order_serialization",
    "serialize_order_list_item": "_order_serialization",
    "_settle_registration_orders": "_class_settlement",
    "close_category_for_class": "_class_settlement",
    "reopen_category_for_class": "_class_settlement",
    "set_class_collected": "_class_settlement",
    "set_class_member_product": "_class_settlement",
    "set_class_paid": "_class_settlement",
    "set_current_registration_product": "_registration",
}


def __getattr__(name: str):
    """Keep the former split-module imports working for existing integrations."""
    module_name = _MOVED_SYMBOLS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    from importlib import import_module

    module = import_module(f"{__package__}.{module_name}")
    return getattr(module, name)
