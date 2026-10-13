"""學生授權的家人代訂。身份來自登入帳號，授權來自具名連結。"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import (
    Order,
    Product,
    ProductCategory,
    ProductSeries,
    ProductStatus,
    ShopDelegationLink,
)
from api.models.user import User
from api.schemas.shop import (
    CurrentRegistrationUpdate,
    ProductOut,
    RegistrationVariantCreate,
    ShopDelegationContextOut,
    ShopDelegationCreate,
    ShopDelegationOut,
    ShopPromotionPreviewOut,
    ShopPromotionProductTargetOut,
)
from api.services import school_class as class_svc
from api.services.shop import _catalog, _delegation_codes, _orders, _promotions


class DelegationError(ValueError):
    def __init__(self, message: str, status_code: int = 403):
        super().__init__(message)
        self.status_code = status_code


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def serialize_link(
    session: AsyncSession, link: ShopDelegationLink, *, token: str | None = None
) -> ShopDelegationOut:
    bound = await session.get(User, link.bound_user_id) if link.bound_user_id else None
    return ShopDelegationOut.model_validate(link).model_copy(
        update={
            "token": token,
            "bound_user_name": bound.display_name if bound else None,
            "bound_user_email": bound.email if bound else None,
        }
    )


async def owned_link(session: AsyncSession, user: User, link_id: uuid.UUID) -> ShopDelegationLink:
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    link = await session.scalar(
        select(ShopDelegationLink)
        .where(ShopDelegationLink.id == link_id, ShopDelegationLink.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if link is None:
        raise DelegationError("找不到此代訂連結", 404)
    return link


async def create_link(
    session: AsyncSession, user: User, data: ShopDelegationCreate
) -> ShopDelegationOut:
    if not user.student_id:
        raise DelegationError("僅學生可建立家人代訂連結")
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    count = await session.scalar(
        select(func.count())
        .select_from(ShopDelegationLink)
        .where(
            ShopDelegationLink.user_id == user.id,
            ShopDelegationLink.revoked_at.is_(None),
        )
    )
    if count is not None and count >= 20:
        raise DelegationError("最多保留 20 個有效代訂連結，請先撤銷不再使用的連結", 409)
    category = await session.get(ProductCategory, data.category_id)
    if category is None or not category.is_active:
        raise DelegationError("找不到此商品主題", 404)
    token = secrets.token_urlsafe(32)
    link = ShopDelegationLink(
        user_id=user.id,
        category_id=category.id,
        activity_id=category.activity_id,
        name=data.name,
        token_hash=token_hash(token),
    )
    session.add(link)
    await session.flush()
    code, expires_at = await _delegation_codes.issue_code(token)
    return (await serialize_link(session, link, token=token)).model_copy(
        update={"authorization_code": code, "authorization_code_expires_at": expires_at}
    )


async def list_links(session: AsyncSession, user: User) -> list[ShopDelegationOut]:
    links = await session.scalars(
        select(ShopDelegationLink)
        .where(ShopDelegationLink.user_id == user.id)
        .order_by(ShopDelegationLink.created_at.desc())
    )
    return [await serialize_link(session, link) for link in links]


async def rename_link(
    session: AsyncSession, user: User, link_id: uuid.UUID, name: str
) -> ShopDelegationOut:
    link = await owned_link(session, user, link_id)
    link.name = name
    await session.flush()
    return await serialize_link(session, link)


async def revoke_link(session: AsyncSession, user: User, link_id: uuid.UUID) -> ShopDelegationLink:
    link = await owned_link(session, user, link_id)
    link.revoked_at = datetime.now(UTC)
    await session.flush()
    return link


async def renew_link(session: AsyncSession, user: User, link_id: uuid.UUID) -> ShopDelegationOut:
    link = await revoke_link(session, user, link_id)
    return await create_link(
        session,
        user,
        ShopDelegationCreate(
            name=link.name,
            category_id=link.category_id,
        ),
    )


async def assert_link_open(session: AsyncSession, link: ShopDelegationLink, user: User) -> None:
    school_class = await class_svc.resolve_user_class(session, user)
    category_ids = select(ProductCategory.id).where(ProductCategory.is_active.is_(True))
    category_ids = category_ids.where(
        ProductCategory.activity_id == link.activity_id
        if link.activity_id
        else ProductCategory.id == link.category_id
    )
    series_ids = select(ProductSeries.id).where(
        ProductSeries.category_id.in_(category_ids),
        ProductSeries.is_active.is_(True),
    )
    products = await session.scalars(
        select(Product)
        .options(
            selectinload(Product.category),
            selectinload(Product.series).selectinload(ProductSeries.category),
        )
        .where(
            (Product.series_id.is_(None) & Product.category_id.in_(category_ids))
            | Product.series_id.in_(series_ids),
            Product.status.in_((ProductStatus.ACTIVE, ProductStatus.SOLD_OUT)),
        )
    )
    for product in products:
        try:
            await _orders._assert_product_registration_open(
                session,
                product,
                class_id=school_class.id if school_class else None,
                allow_sold_out=True,
            )
        except ValueError:
            continue
        return
    raise DelegationError("此連結的商品尚未開放、已截止或班級已結單", 410)


async def resolve_link(
    session: AsyncSession, actor: User, token: str, *, claim: bool = False, write: bool = False
) -> tuple[ShopDelegationLink, User]:
    digest = token_hash(token)
    owner_id = await session.scalar(
        select(ShopDelegationLink.user_id).where(ShopDelegationLink.token_hash == digest)
    )
    if owner_id is None:
        raise DelegationError("代訂連結無效", 404)
    # 所有登記先鎖學生，再鎖連結／商品，與本人登記及撤銷維持相同順序。
    await session.execute(select(User.id).where(User.id == owner_id).with_for_update())
    link = await session.scalar(
        select(ShopDelegationLink)
        .where(ShopDelegationLink.token_hash == digest)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if link is None or link.revoked_at is not None:
        raise DelegationError("此代訂連結已撤銷", 410)
    user = await session.get(User, link.user_id)
    if user is None or not user.is_active or not user.student_id:
        raise DelegationError("學生帳號無法使用代訂", 410)
    category = await session.get(ProductCategory, link.category_id)
    if category is None or not category.is_active or category.activity_id != link.activity_id:
        raise DelegationError("此代訂連結的商品主題已變更或關閉", 410)
    await assert_link_open(session, link, user)
    if actor.id == user.id:
        if claim or write:
            raise DelegationError("請以學生本人的商品頁管理登記")
        return link, user
    if link.bound_user_id is not None and link.bound_user_id != actor.id:
        raise DelegationError("此連結已綁定另一個帳號，請學生另建連結")
    if claim and link.bound_user_id is None:
        link.bound_user_id = actor.id
        await session.flush()
    if write and link.bound_user_id != actor.id:
        raise DelegationError("請先使用此帳號確認代訂")
    return link, user


def assert_product_scope(link: ShopDelegationLink, product: Product) -> None:
    category = product.category or (product.series.category if product.series else None)
    if (
        category is None
        or not category.is_active
        or (product.series is not None and not product.series.is_active)
        or product.status not in (ProductStatus.ACTIVE, ProductStatus.SOLD_OUT)
    ):
        raise DelegationError("找不到此商品", 404)
    scope = _orders._product_order_scope(product)
    allowed = (link.activity_id, None if link.activity_id else link.category_id)
    if scope != allowed:
        raise DelegationError("此商品不在連結授權範圍內", 404)


async def context(
    session: AsyncSession, actor: User, token: str, *, claim: bool = False
) -> ShopDelegationContextOut:
    link, user = await resolve_link(session, actor, token, claim=claim)
    catalog = await _catalog.build_catalog_tree(session, activity_id=link.activity_id)
    catalog = [row for row in catalog if link.activity_id or row.id == link.category_id]
    school_class = await class_svc.resolve_user_class(session, user)
    closes = await _orders.get_close_status(
        session, [row.id for row in catalog], school_class.id if school_class else None
    )
    closed_ids = [key for key, value in closes.items() if value is not None]
    # 未確認綁定前只提供商品與學生顯示名稱，不提供訂單、優惠或其他家人的資料。
    confirmed = link.bound_user_id == actor.id or user.id == actor.id
    order = None
    promotions = []
    if confirmed:
        order = await _orders.get_current_registration(
            session,
            user.id,
            activity_id=link.activity_id,
            category_id=None if link.activity_id else link.category_id,
            match_activity=True,
        )
        promotions = await _promotions.list_public_promotions(session, user_id=user.id)
    return ShopDelegationContextOut(
        link=ShopDelegationOut.model_validate(link),
        student_name=user.display_name,
        can_claim=not confirmed,
        can_edit=confirmed and actor.id != user.id,
        registration=_orders.serialize_order(order) if order else None,
        catalog=catalog,
        promotions=[
            _promotions.serialize_public_promotion(p)
            for p in promotions
            if p.activity_id == link.activity_id
        ],
        closed_category_ids=closed_ids,
    )


async def delegated_product(
    session: AsyncSession, actor: User, token: str, product_id: uuid.UUID
) -> ProductOut:
    link, user = await resolve_link(session, actor, token, write=True)
    product = await _catalog.get_product(session, product_id)
    if product is None:
        raise DelegationError("找不到此商品", 404)
    assert_product_scope(link, product)
    remaining = await _orders.remaining_product_quantity(session, product, user.id)
    return ProductOut.model_validate(product).model_copy(
        update={"remaining_quantity_for_user": remaining}
    )


async def set_product(
    session: AsyncSession,
    actor: User,
    token: str,
    product_id: uuid.UUID,
    data: CurrentRegistrationUpdate,
) -> Order | None:
    link, user = await resolve_link(session, actor, token, write=True)
    product = await _catalog.get_product(session, product_id)
    if product is None:
        raise DelegationError("找不到此商品", 404)
    assert_product_scope(link, product)
    return await _orders.set_current_registration_product(
        session,
        user,
        product_id,
        data=data,
        actor=actor,
        delegation=link,
    )


async def preview(
    session: AsyncSession, user: User, link: ShopDelegationLink, code: str | None
) -> ShopPromotionPreviewOut:
    order = await _orders.get_current_registration(
        session,
        user.id,
        activity_id=link.activity_id,
        category_id=None if link.activity_id else link.category_id,
        match_activity=True,
    )
    subtotal = order.subtotal_price if order else 0
    result = await _promotions.preview_promotion(
        session,
        user_id=user.id,
        subtotal=subtotal,
        code=code,
        product_subtotals=_orders._promotion_product_subtotals(order.items) if order else {},
        product_quantities=_orders._promotion_product_quantities(order.items) if order else {},
        activity_id=link.activity_id,
        current_promotion_ids={row.promotion_id for row in order.applied_promotions}
        if order
        else set(),
    )
    promotion = result.promotion
    return ShopPromotionPreviewOut.model_validate(
        dict(
            eligible=result.eligible,
            reason_code=result.reason_code,
            reason=result.reason,
            subtotal_price=subtotal,
            discount_amount=result.discount_amount,
            total_price=max(0, subtotal - result.discount_amount),
            shortfall=result.shortfall,
            quantity_shortfall=result.quantity_shortfall,
            promotion_name=promotion.name if promotion else None,
            promotion_code=promotion.code if promotion else None,
            min_order_price=promotion.min_order_price if promotion else None,
            min_quantity=promotion.min_quantity if promotion else None,
            discount_type=promotion.discount_type if promotion else None,
            discount_value=promotion.discount_value if promotion else None,
            target_products=[
                ShopPromotionProductTargetOut(id=p.id, name=p.name)
                for p in (promotion.target_products or [])
            ]
            if promotion
            else [],
            product_price_overrides=_promotions.serialize_product_price_overrides(promotion)
            if promotion
            else [],
        )
    )


async def update_owned_item(
    session: AsyncSession, user: User, order_id: uuid.UUID, item_id: uuid.UUID, quantity: int
) -> Order | None:
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    order = await _orders.get_order(session, order_id)
    if order is None or order.user_id != user.id:
        raise DelegationError("找不到此訂單", 404)
    item = next((row for row in order.items if row.id == item_id), None)
    if item is None:
        raise DelegationError("找不到此品項", 404)
    current = await _orders.get_current_registration(
        session,
        user.id,
        activity_id=order.activity_id,
        category_id=order.category_id,
        match_activity=True,
        lock=True,
    )
    if current is None or current.id != order.id:
        raise DelegationError("此訂單已無法修改", 409)
    link = (
        await session.get(ShopDelegationLink, item.delegation_link_id)
        if item.delegation_link_id
        else None
    )
    variants = [
        RegistrationVariantCreate(
            option_ids=[uuid.UUID(str(o["option_id"])) for o in row.selected_options],
            quantity=quantity if row.id == item.id else row.quantity,
        )
        for row in order.items
        if row.product_id == item.product_id
        and row.delegation_link_id == item.delegation_link_id
        and (row.id != item.id or quantity > 0)
    ]
    return await _orders.set_current_registration_product(
        session,
        user,
        item.product_id,
        data=CurrentRegistrationUpdate(variants=variants),
        delegation=link,
    )
