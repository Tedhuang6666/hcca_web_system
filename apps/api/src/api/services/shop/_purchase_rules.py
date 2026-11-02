"""商品購買資格。檢查購買者本人，管理權限不豁免購買限制。"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductStatus
from api.models.user import User
from api.schemas.shop import ProductPurchaseRules
from api.services.permission import get_user_permission_codes
from api.services.school_class import resolve_user_class
from api.services.student_identity_rules import student_id_from_school_email


@dataclass(frozen=True)
class PurchaseContext:
    identifiers: frozenset[str]
    grade: int | None
    permissions: frozenset[str]


async def purchase_context(
    session: AsyncSession, user: User | None, rules: list[ProductPurchaseRules]
) -> PurchaseContext | None:
    if user is None:
        return None
    school_class = (
        await resolve_user_class(session, user)
        if any(rule.allowed_grades for rule in rules)
        else None
    )
    permissions = (
        await get_user_permission_codes(session, user.id, on_date=local_today())
        if any(rule.required_permissions for rule in rules)
        else frozenset()
    )
    return PurchaseContext(
        identifiers=frozenset(
            value.strip().lower()
            for value in (user.email, user.student_id or student_id_from_school_email(user.email))
            if value
        ),
        grade=school_class.grade if school_class else None,
        permissions=permissions,
    )


def purchase_restriction(rules: ProductPurchaseRules, buyer: PurchaseContext | None) -> str | None:
    if not any(rules.model_dump().values()):
        return None
    if buyer is None:
        return "此商品有購買資格限制，請登入後確認"
    if buyer.identifiers.intersection(rules.blocked_identifiers):
        return "您在此商品的禁止購買名單中，無法購買；如有疑問請聯絡班聯"
    if rules.designated_only and not buyer.identifiers.intersection(rules.allowed_identifiers):
        return "此票種僅限班聯指定名單購買，您的帳號未被指定此票種"
    if rules.allowed_grades and buyer.grade not in rules.allowed_grades:
        grades = "、".join(f"高{['一', '二', '三'][grade - 1]}" for grade in rules.allowed_grades)
        return f"此商品限{grades}購買，您的年級不符合或尚未確認"
    if rules.required_permissions and not buyer.permissions.intersection(
        rules.required_permissions
    ):
        return "此商品限具指定權限者購買，您的帳號未符合資格"
    if rules.allowed_identifiers and not buyer.identifiers.intersection(rules.allowed_identifiers):
        return "此商品僅限指定名單購買，您的帳號不在名單中"
    return None


async def product_purchase_restriction(
    session: AsyncSession, product: Product, user: User | None
) -> str | None:
    return (await purchase_restrictions(session, [product], user))[product.id]


async def purchase_restrictions(
    session: AsyncSession,
    products: list[Product],
    user: User | None,
    *,
    include_purchased: bool = True,
) -> dict[UUID, str | None]:
    rules = {
        product.id: ProductPurchaseRules.model_validate(product.purchase_rules or {})
        for product in products
    }
    buyer = await purchase_context(session, user, list(rules.values()))
    groups = {rule.exclusive_group for rule in rules.values() if rule.exclusive_group}
    counts = (
        await purchased_group_quantities(session, user.id, groups)
        if user and groups and include_purchased
        else {}
    )
    designated = await designated_group_products(session, groups, buyer) if groups and buyer else {}
    return {
        product_id: purchase_restriction(rule, buyer)
        or designated_restriction(product_id, rule.exclusive_group, designated)
        or (
            "同組商品合計限購一件，您已有訂購的票券"
            if rule.exclusive_group and counts.get(rule.exclusive_group, 0) >= 1
            else None
        )
        for product_id, rule in rules.items()
    }


async def assert_product_purchase_allowed(
    session: AsyncSession, product: Product, user: User
) -> None:
    reason = (await purchase_restrictions(session, [product], user, include_purchased=False))[
        product.id
    ]
    if reason:
        raise ValueError(f"商品「{product.name}」：{reason}")


async def designated_group_products(
    session: AsyncSession, groups: set[str], buyer: PurchaseContext
) -> dict[str, set[UUID]]:
    rows = await session.execute(
        select(Product.id, Product.purchase_rules).where(
            Product.purchase_rules["exclusive_group"].as_string().in_(groups),
            Product.purchase_rules["designated_only"].as_boolean().is_(True),
            Product.status.in_([ProductStatus.ACTIVE, ProductStatus.SOLD_OUT]),
        )
    )
    designated: dict[str, set[UUID]] = {}
    for product_id, data in rows:
        if buyer.identifiers.intersection(data.get("allowed_identifiers", [])):
            designated.setdefault(data["exclusive_group"], set()).add(product_id)
    return designated


def designated_restriction(
    product_id: UUID, group: str | None, designated: dict[str, set[UUID]]
) -> str | None:
    targets = designated.get(group, set()) if group else set()
    if len(targets) > 1:
        return "您的指定票種名單重複，請聯絡班聯確認後再購買"
    if targets and product_id not in targets:
        return "班聯已指定您購買同組其他票種，此商品已鎖定，無法購買"
    return None


async def purchased_group_quantities(
    session: AsyncSession,
    user_id: UUID,
    groups: set[str],
    *,
    excluding_order_id: UUID | None = None,
    excluding_product_id: UUID | None = None,
) -> dict[str, int]:
    group = Product.purchase_rules["exclusive_group"].as_string()
    query = (
        select(group, func.sum(OrderItem.quantity))
        .select_from(OrderItem)
        .join(Order, Order.id == OrderItem.order_id)
        .join(Product, Product.id == OrderItem.product_id)
        .where(
            Order.user_id == user_id,
            Order.status.in_([OrderStatus.PENDING, OrderStatus.CONFIRMED]),
            Order.test_product_id.is_(None),
            group.in_(groups),
        )
        .group_by(group)
    )
    if excluding_order_id:
        query = query.where(
            (Order.id != excluding_order_id) | (OrderItem.product_id != excluding_product_id)
            if excluding_product_id is not None
            else Order.id != excluding_order_id
        )
    return {name: int(quantity) for name, quantity in (await session.execute(query)).all()}


async def assert_group_purchase_limit(
    session: AsyncSession,
    user_id: UUID,
    quantities: dict[UUID, int],
    *,
    excluding_order_id: UUID | None = None,
    excluding_product_id: UUID | None = None,
) -> None:
    if not quantities:
        return
    products = await session.scalars(select(Product).where(Product.id.in_(quantities)))
    requested: dict[str, int] = {}
    for product in products:
        group = (product.purchase_rules or {}).get("exclusive_group")
        if group:
            requested[group] = requested.get(group, 0) + quantities[product.id]
    if not requested:
        return
    purchased = await purchased_group_quantities(
        session,
        user_id,
        set(requested),
        excluding_order_id=excluding_order_id,
        excluding_product_id=excluding_product_id,
    )
    for group, quantity in requested.items():
        if quantity + purchased.get(group, 0) > 1:
            raise ValueError("同組商品每人合計只能訂購一件，不能同時購買其他票種")
