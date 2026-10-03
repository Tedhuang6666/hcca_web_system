"""校商優惠與優惠碼服務。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.activity import Activity
from api.models.shop import (
    Order,
    Product,
    ProductSeries,
    ShopDiscountType,
    ShopOrderPromotion,
    ShopPromotion,
)
from api.models.user import User
from api.schemas.shop import (
    ShopPromotionCreate,
    ShopPromotionOut,
    ShopPromotionProductTargetOut,
    ShopPromotionPublicOut,
    ShopPromotionTargetOut,
    ShopPromotionUpdate,
)
from api.services._base import apply_updates


@dataclass(frozen=True)
class PromotionResult:
    promotion: ShopPromotion | None
    discount_amount: int


@dataclass(frozen=True)
class PromotionAllocation:
    promotion: ShopPromotion
    discount_amount: int


@dataclass(frozen=True)
class PromotionBundleResult:
    allocations: tuple[PromotionAllocation, ...]

    @property
    def promotion(self) -> ShopPromotion | None:
        for allocation in self.allocations:
            if allocation.promotion.code:
                return allocation.promotion
        return self.allocations[0].promotion if self.allocations else None

    @property
    def discount_amount(self) -> int:
        return sum(row.discount_amount for row in self.allocations)


@dataclass(frozen=True)
class PromotionPreviewResult:
    promotion: ShopPromotion | None
    eligible: bool
    discount_amount: int
    reason_code: str
    reason: str | None = None
    shortfall: int = 0
    quantity_shortfall: int = 0
    allocations: tuple[PromotionAllocation, ...] = ()


def normalize_promotion_code(code: str | None) -> str | None:
    normalized = code.strip().upper() if code else None
    return normalized or None


def _validate_discount(discount_type: ShopDiscountType, discount_value: int) -> None:
    if discount_type == ShopDiscountType.PERCENTAGE and discount_value > 100:
        raise ValueError("百分比優惠必須介於 1 到 100")


async def _target_users(session: AsyncSession, identifiers: list[str]) -> list[User]:
    normalized: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw_identifier in identifiers:
        identifier = raw_identifier.strip()
        key = identifier.lower()
        if not identifier or key in seen:
            continue
        if "@" in identifier:
            local, separator, domain = identifier.partition("@")
            if (
                not separator
                or not local
                or not domain
                or any(char.isspace() for char in identifier)
            ):
                raise ValueError(f"Email 格式不正確：{identifier}")
            normalized.append(("email", key))
        else:
            normalized.append(("student_id", key))
        seen.add(key)

    if not normalized:
        return []

    emails = [value for kind, value in normalized if kind == "email"]
    student_ids = [value for kind, value in normalized if kind == "student_id"]
    filters = []
    if emails:
        filters.append(func.lower(User.email).in_(emails))
    if student_ids:
        filters.append(func.lower(User.student_id).in_(student_ids))
    users = (await session.execute(select(User).where(or_(*filters)))).scalars().all()
    by_email = {user.email.strip().lower(): user for user in users}
    by_student_id = {user.student_id.strip().lower(): user for user in users if user.student_id}

    targets: list[User] = []
    target_ids: set[uuid.UUID] = set()
    for kind, identifier in normalized:
        user = by_email.get(identifier) if kind == "email" else by_student_id.get(identifier)
        if user is None:
            label = "Email" if kind == "email" else "學號"
            raise ValueError(f"找不到指定的{label}：{identifier}")
        if user.id not in target_ids:
            targets.append(user)
            target_ids.add(user.id)
    return targets


async def _target_products(session: AsyncSession, product_ids: list[uuid.UUID]) -> list[Product]:
    unique_ids = list(dict.fromkeys(product_ids))
    if not unique_ids:
        return []
    products = list(
        (
            await session.execute(
                select(Product)
                .options(
                    selectinload(Product.category),
                    selectinload(Product.series).selectinload(ProductSeries.category),
                )
                .where(Product.id.in_(unique_ids))
                .order_by(Product.name)
            )
        )
        .scalars()
        .all()
    )
    found_ids = {product.id for product in products}
    missing_ids = [str(product_id) for product_id in unique_ids if product_id not in found_ids]
    if missing_ids:
        raise ValueError(f"找不到指定商品：{', '.join(missing_ids)}")
    return products


def _product_activity_id(product: Product) -> uuid.UUID | None:
    category = product.category
    if category is None and product.series is not None:
        category = product.series.category
    return category.activity_id if category is not None else None


def _resolve_activity_scope(
    requested_activity_id: uuid.UUID | None,
    target_products: list[Product],
    *,
    infer_activity: bool,
) -> uuid.UUID | None:
    product_scopes = {_product_activity_id(product) for product in target_products}
    if len(product_scopes) > 1:
        raise ValueError("同一項優惠的指定商品必須屬於同一活動")
    product_scope = next(iter(product_scopes), None)
    if infer_activity and requested_activity_id is None:
        return product_scope
    if target_products and product_scope != requested_activity_id:
        raise ValueError("優惠適用活動必須與指定商品所屬活動一致")
    return requested_activity_id


def _promotion_targets_user(user_id: uuid.UUID):
    return or_(
        ShopPromotion.target_user_id == user_id,
        ShopPromotion.target_users.any(User.id == user_id),
    )


def _promotion_can_target_user(user_id: uuid.UUID):
    return or_(
        and_(
            ShopPromotion.target_user_id.is_(None),
            ~ShopPromotion.target_users.any(),
        ),
        _promotion_targets_user(user_id),
    )


def _promotion_allows_user(promotion: ShopPromotion, user_id: uuid.UUID) -> bool:
    targets = list(promotion.target_users or [])
    if promotion.target_user_id is None and not targets:
        return True
    return promotion.target_user_id == user_id or any(user.id == user_id for user in targets)


def _promotion_eligible_subtotal(
    promotion: ShopPromotion,
    subtotal: int,
    product_subtotals: dict[uuid.UUID, int] | None,
) -> int:
    target_ids = {product.id for product in (promotion.target_products or [])}
    if not target_ids:
        return subtotal
    amounts = product_subtotals or {}
    if not target_ids.issubset(amounts):
        return 0
    return sum(amounts.get(product_id, 0) for product_id in target_ids)


def _promotion_eligible_quantity(
    promotion: ShopPromotion,
    product_quantities: dict[uuid.UUID, int] | None,
) -> int:
    quantities = product_quantities or {}
    target_ids = {product.id for product in (promotion.target_products or [])}
    selected_ids = target_ids or quantities.keys()
    return sum(quantities.get(product_id, 0) for product_id in selected_ids)


def _promotion_issue(
    promotion: ShopPromotion,
    *,
    user_id: uuid.UUID,
    subtotal: int,
    now: datetime,
    product_subtotals: dict[uuid.UUID, int] | None = None,
    product_quantities: dict[uuid.UUID, int] | None = None,
    activity_id: uuid.UUID | None = None,
    current_promotion_id: uuid.UUID | None = None,
    current_promotion_ids: set[uuid.UUID] | None = None,
) -> tuple[str, str, int, int] | None:
    if not promotion.is_active:
        return "inactive", "此優惠目前未開放使用。", 0, 0
    if promotion.starts_at and promotion.starts_at > now:
        start = promotion.starts_at.astimezone(UTC).strftime("%Y/%m/%d %H:%M")
        return "not_started", f"此優惠將於 {start} 開始。", 0, 0
    if promotion.ends_at and promotion.ends_at < now:
        return "expired", "此優惠已結束。", 0, 0
    if promotion.activity_id != activity_id:
        return "activity_not_matched", "此優惠僅適用於所屬活動。", 0, 0
    current_ids = set(current_promotion_ids or ())
    if current_promotion_id is not None:
        current_ids.add(current_promotion_id)
    if (
        promotion.max_uses is not None
        and promotion.used_count >= promotion.max_uses
        and promotion.id not in current_ids
    ):
        return "usage_limit", "此優惠已達可使用次數上限。", 0, 0
    if not _promotion_allows_user(promotion, user_id):
        return "account_not_eligible", "此優惠限符合資格的帳號使用，您的帳號目前不符合資格。", 0, 0
    target_ids = {product.id for product in (promotion.target_products or [])}
    selected_ids = set(product_subtotals or {})
    if target_ids and not target_ids.issubset(selected_ids):
        missing_names = [
            product.name
            for product in (promotion.target_products or [])
            if product.id not in selected_ids
        ]
        missing_label = "、".join(missing_names) or "指定商品"
        return "items_not_matched", f"需同時登記「{missing_label}」才能使用此優惠。", 0, 0
    if subtotal < promotion.min_order_price:
        shortfall = promotion.min_order_price - subtotal
        reason = (
            f"目前商品小計 NT${subtotal:,}，還差 NT${shortfall:,}；"
            f"消費滿 NT${promotion.min_order_price:,} 即可使用。"
        )
        return "minimum_not_met", reason, shortfall, 0
    eligible_quantity = _promotion_eligible_quantity(promotion, product_quantities)
    if eligible_quantity < promotion.min_quantity:
        quantity_shortfall = promotion.min_quantity - eligible_quantity
        scope = "指定組合商品" if target_ids else "商品"
        return (
            "quantity_not_met",
            f"目前{scope}共 {eligible_quantity} 件，再登記 {quantity_shortfall} 件即可達到 {promotion.min_quantity} 件優惠門檻。",
            0,
            quantity_shortfall,
        )
    return None


async def preview_promotion(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    subtotal: int,
    code: str | None = None,
    product_subtotals: dict[uuid.UUID, int] | None = None,
    product_quantities: dict[uuid.UUID, int] | None = None,
    activity_id: uuid.UUID | None = None,
    current_promotion_id: uuid.UUID | None = None,
    current_promotion_ids: set[uuid.UUID] | None = None,
) -> PromotionPreviewResult:
    now = datetime.now(UTC)
    normalized_code = normalize_promotion_code(code)
    load_targets = (
        selectinload(ShopPromotion.target_users),
        selectinload(ShopPromotion.target_products),
    )
    current_ids = set(current_promotion_ids or ())
    if current_promotion_id is not None:
        current_ids.add(current_promotion_id)
    usage_filter = (
        or_(
            ShopPromotion.max_uses.is_(None),
            ShopPromotion.used_count < ShopPromotion.max_uses,
            ShopPromotion.id.in_(current_ids),
        )
        if current_ids
        else or_(
            ShopPromotion.max_uses.is_(None),
            ShopPromotion.used_count < ShopPromotion.max_uses,
        )
    )
    base_filters = (
        ShopPromotion.is_active.is_(True),
        or_(ShopPromotion.starts_at.is_(None), ShopPromotion.starts_at <= now),
        or_(ShopPromotion.ends_at.is_(None), ShopPromotion.ends_at >= now),
        usage_filter,
        ShopPromotion.code.is_(None),
        ShopPromotion.activity_id == activity_id,
        _promotion_can_target_user(user_id),
    )

    if normalized_code:
        promotion = await session.scalar(
            select(ShopPromotion)
            .options(*load_targets)
            .where(func.upper(ShopPromotion.code) == normalized_code)
        )
        if promotion is None:
            return PromotionPreviewResult(
                promotion=None,
                eligible=False,
                discount_amount=0,
                reason_code="invalid_code",
                reason="找不到此優惠碼，請確認輸入內容後再試。",
            )
        issue = _promotion_issue(
            promotion,
            user_id=user_id,
            subtotal=subtotal,
            now=now,
            product_subtotals=product_subtotals,
            product_quantities=product_quantities,
            activity_id=activity_id,
            current_promotion_id=current_promotion_id,
            current_promotion_ids=current_promotion_ids,
        )
        if issue:
            reason_code, reason, shortfall, quantity_shortfall = issue
            return PromotionPreviewResult(
                promotion=promotion,
                eligible=False,
                discount_amount=0,
                reason_code=reason_code,
                reason=reason,
                shortfall=shortfall,
                quantity_shortfall=quantity_shortfall,
            )
        amount = _discount_amount(promotion, subtotal, product_subtotals, product_quantities)
        allocations = [PromotionAllocation(promotion=promotion, discount_amount=amount)]
        remaining = max(0, subtotal - amount)
        automatic_promotions = list(
            (
                await session.execute(
                    select(ShopPromotion)
                    .options(*load_targets)
                    .where(
                        *base_filters,
                        ShopPromotion.activity_id == activity_id,
                        ShopPromotion.code.is_(None),
                        _promotion_can_target_user(user_id),
                    )
                )
            )
            .scalars()
            .all()
        )
        eligible_automatic = [
            candidate
            for candidate in automatic_promotions
            if _promotion_issue(
                candidate,
                user_id=user_id,
                subtotal=subtotal,
                now=now,
                product_subtotals=product_subtotals,
                product_quantities=product_quantities,
                activity_id=activity_id,
                current_promotion_id=current_promotion_id,
                current_promotion_ids=current_promotion_ids,
            )
            is None
            and _discount_amount(candidate, subtotal, product_subtotals, product_quantities) > 0
        ]
        if remaining and eligible_automatic:
            automatic = max(
                eligible_automatic,
                key=lambda candidate: _discount_amount(
                    candidate, subtotal, product_subtotals, product_quantities
                ),
            )
            automatic_amount = min(
                remaining,
                _discount_amount(automatic, subtotal, product_subtotals, product_quantities),
            )
            if automatic_amount:
                allocations.append(
                    PromotionAllocation(promotion=automatic, discount_amount=automatic_amount)
                )
        total_discount = sum(row.discount_amount for row in allocations)
        detail = "、".join(
            f"「{row.promotion.name}」折抵 NT${row.discount_amount:,}" for row in allocations
        )
        return PromotionPreviewResult(
            promotion=promotion,
            eligible=total_discount > 0,
            discount_amount=total_discount,
            reason_code="applied" if total_discount > 0 else "minimum_not_met",
            reason=f"已套用{detail}，共省下 NT${total_discount:,}。"
            if total_discount
            else "此優惠目前無法折抵。",
            quantity_shortfall=0,
            allocations=tuple(allocations),
        )

    promotions = list(
        (await session.execute(select(ShopPromotion).options(*load_targets).where(*base_filters)))
        .scalars()
        .all()
    )
    eligible = [
        promotion
        for promotion in promotions
        if _promotion_issue(
            promotion,
            user_id=user_id,
            subtotal=subtotal,
            now=now,
            product_subtotals=product_subtotals,
            product_quantities=product_quantities,
            activity_id=activity_id,
            current_promotion_id=current_promotion_id,
            current_promotion_ids=current_promotion_ids,
        )
        is None
        and _discount_amount(promotion, subtotal, product_subtotals, product_quantities) > 0
    ]
    if eligible:
        selected = max(
            eligible,
            key=lambda promotion: _discount_amount(
                promotion, subtotal, product_subtotals, product_quantities
            ),
        )
        amount = _discount_amount(selected, subtotal, product_subtotals, product_quantities)
        return PromotionPreviewResult(
            promotion=selected,
            eligible=True,
            discount_amount=amount,
            reason_code="applied",
            reason=f"已自動套用「{selected.name}」，共省下 NT${amount:,}。",
            allocations=(PromotionAllocation(promotion=selected, discount_amount=amount),),
        )

    issue_candidates = []
    for promotion in promotions:
        issue = _promotion_issue(
            promotion,
            user_id=user_id,
            subtotal=subtotal,
            now=now,
            product_subtotals=product_subtotals,
            product_quantities=product_quantities,
            activity_id=activity_id,
            current_promotion_id=current_promotion_id,
            current_promotion_ids=current_promotion_ids,
        )
        if issue and issue[0] in {
            "items_not_matched",
            "minimum_not_met",
            "quantity_not_met",
        }:
            missing = len(
                {
                    product.id
                    for product in (promotion.target_products or [])
                    if product.id not in (product_subtotals or {})
                }
            )
            issue_candidates.append((missing, issue[2] + issue[3], promotion, issue))
    if issue_candidates:
        _, _, selected, issue = min(issue_candidates, key=lambda item: (item[0], item[1]))
        reason_code, reason, shortfall, quantity_shortfall = issue
        return PromotionPreviewResult(
            promotion=selected,
            eligible=False,
            discount_amount=0,
            reason_code=reason_code,
            reason=reason,
            shortfall=shortfall,
            quantity_shortfall=quantity_shortfall,
        )

    return PromotionPreviewResult(
        promotion=None,
        eligible=False,
        discount_amount=0,
        reason_code="no_promotion",
    )


async def create_promotion(
    session: AsyncSession, *, data: ShopPromotionCreate, created_by: uuid.UUID
) -> ShopPromotion:
    code = normalize_promotion_code(data.code)
    identifiers = list(data.target_identifiers)
    if data.target_email:
        identifiers.append(data.target_email)
    target_users = await _target_users(session, identifiers)
    target_products = await _target_products(session, data.target_product_ids)
    activity_id = _resolve_activity_scope(data.activity_id, target_products, infer_activity=True)
    if activity_id is not None and await session.get(Activity, activity_id) is None:
        raise ValueError("找不到指定活動")
    _validate_discount(data.discount_type, data.discount_value)
    if data.starts_at and data.ends_at and data.starts_at >= data.ends_at:
        raise ValueError("優惠開始時間必須早於結束時間")
    if code and await session.scalar(
        select(ShopPromotion.id).where(func.upper(ShopPromotion.code) == code)
    ):
        raise ValueError("優惠碼已存在")

    promotion = ShopPromotion(
        name=data.name.strip(),
        activity_id=activity_id,
        code=code,
        target_user_id=target_users[0].id if len(target_users) == 1 else None,
        target_users=target_users,
        target_products=target_products,
        discount_type=data.discount_type,
        discount_value=data.discount_value,
        min_order_price=data.min_order_price,
        min_quantity=data.min_quantity,
        starts_at=data.starts_at,
        ends_at=data.ends_at,
        max_uses=data.max_uses,
        description=data.description,
        created_by=created_by,
    )
    session.add(promotion)
    await session.flush()
    return await get_promotion(session, promotion.id) or promotion


async def list_promotions(
    session: AsyncSession, *, include_inactive: bool = False
) -> list[ShopPromotion]:
    query = select(ShopPromotion).options(
        selectinload(ShopPromotion.target_user),
        selectinload(ShopPromotion.target_users),
        selectinload(ShopPromotion.target_products),
    )
    if not include_inactive:
        query = query.where(ShopPromotion.is_active.is_(True))
    query = query.order_by(ShopPromotion.created_at.desc())
    return list((await session.execute(query)).scalars().all())


async def list_public_promotions(
    session: AsyncSession, *, user_id: uuid.UUID | None = None
) -> list[ShopPromotion]:
    now = datetime.now(UTC)
    filters = [
        ShopPromotion.is_active.is_(True),
        or_(ShopPromotion.starts_at.is_(None), ShopPromotion.starts_at <= now),
        or_(ShopPromotion.ends_at.is_(None), ShopPromotion.ends_at >= now),
        or_(ShopPromotion.max_uses.is_(None), ShopPromotion.used_count < ShopPromotion.max_uses),
    ]
    if user_id is None:
        filters.append(
            and_(ShopPromotion.target_user_id.is_(None), ~ShopPromotion.target_users.any())
        )
    else:
        filters.append(_promotion_can_target_user(user_id))
    query = (
        select(ShopPromotion)
        .options(
            selectinload(ShopPromotion.target_users),
            selectinload(ShopPromotion.target_products),
        )
        .where(*filters)
        .order_by(ShopPromotion.created_at.desc())
    )
    promotions = list((await session.execute(query)).scalars().all())
    if user_id is None:
        return promotions
    return [promotion for promotion in promotions if _promotion_allows_user(promotion, user_id)]


async def get_promotion(session: AsyncSession, promotion_id: uuid.UUID) -> ShopPromotion | None:
    return await session.scalar(
        select(ShopPromotion)
        .options(
            selectinload(ShopPromotion.target_user),
            selectinload(ShopPromotion.target_users),
            selectinload(ShopPromotion.target_products),
        )
        .where(ShopPromotion.id == promotion_id)
    )


async def delete_promotion(session: AsyncSession, promotion: ShopPromotion) -> None:
    if promotion.used_count > 0:
        raise ValueError("此優惠已有使用紀錄，為保留訂單歷史無法刪除")

    has_order_reference = await session.scalar(
        select(Order.id).where(Order.promotion_id == promotion.id).limit(1)
    )
    has_applied_promotion = await session.scalar(
        select(ShopOrderPromotion.order_id)
        .where(ShopOrderPromotion.promotion_id == promotion.id)
        .limit(1)
    )
    if has_order_reference is not None or has_applied_promotion is not None:
        raise ValueError("此優惠已有訂單紀錄，為保留訂單歷史無法刪除")

    await session.delete(promotion)
    await session.flush()


async def update_promotion(
    session: AsyncSession, promotion: ShopPromotion, *, data: ShopPromotionUpdate
) -> ShopPromotion:
    payload = data.model_dump(exclude_unset=True)
    activity_was_explicit = "activity_id" in payload
    target_products_changed = "target_product_ids" in payload
    requested_activity_id = payload.pop("activity_id", promotion.activity_id)
    target_users: list[User] | None = None
    target_products: list[Product] | None = None
    if "target_identifiers" in payload or "target_email" in payload:
        identifiers = payload.pop("target_identifiers", None)
        target_email = payload.pop("target_email", None)
        if identifiers is None:
            identifiers = []
        if target_email:
            identifiers = [*identifiers, target_email]
        target_users = await _target_users(session, identifiers)
    if "target_product_ids" in payload:
        product_ids = payload.pop("target_product_ids", None) or []
        target_products = await _target_products(session, product_ids)
    if "code" in payload:
        payload["code"] = normalize_promotion_code(payload["code"])
        if payload["code"] and await session.scalar(
            select(ShopPromotion.id).where(
                func.upper(ShopPromotion.code) == payload["code"],
                ShopPromotion.id != promotion.id,
            )
        ):
            raise ValueError("優惠碼已存在")
    if target_users is not None:
        promotion.target_users = target_users
        promotion.target_user_id = target_users[0].id if len(target_users) == 1 else None
    if target_products is not None:
        promotion.target_products = target_products
    if activity_was_explicit or target_products_changed:
        effective_products = target_products
        if effective_products is None:
            effective_products = await _target_products(
                session, [product.id for product in (promotion.target_products or [])]
            )
        activity_id = _resolve_activity_scope(
            requested_activity_id,
            effective_products,
            infer_activity=(
                target_products_changed and not activity_was_explicit and bool(effective_products)
            ),
        )
        if activity_id is not None and await session.get(Activity, activity_id) is None:
            raise ValueError("找不到指定活動")
        promotion.activity_id = activity_id
    apply_updates(promotion, payload)
    _validate_discount(promotion.discount_type, promotion.discount_value)
    if promotion.starts_at and promotion.ends_at and promotion.starts_at >= promotion.ends_at:
        raise ValueError("優惠開始時間必須早於結束時間")
    await session.flush()
    await session.refresh(promotion, attribute_names=["target_user"])
    return promotion


def _discount_amount(
    promotion: ShopPromotion,
    subtotal: int,
    product_subtotals: dict[uuid.UUID, int] | None = None,
    product_quantities: dict[uuid.UUID, int] | None = None,
) -> int:
    if subtotal < promotion.min_order_price:
        return 0
    if _promotion_eligible_quantity(promotion, product_quantities) < promotion.min_quantity:
        return 0
    eligible_subtotal = _promotion_eligible_subtotal(promotion, subtotal, product_subtotals)
    if eligible_subtotal <= 0:
        return 0
    if promotion.discount_type == ShopDiscountType.PERCENTAGE:
        return min(eligible_subtotal, eligible_subtotal * promotion.discount_value // 100)
    return min(eligible_subtotal, promotion.discount_value)


async def resolve_promotion(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    subtotal: int,
    code: str | None = None,
    product_subtotals: dict[uuid.UUID, int] | None = None,
    product_quantities: dict[uuid.UUID, int] | None = None,
    activity_id: uuid.UUID | None = None,
    current_promotion_id: uuid.UUID | None = None,
    current_promotion_ids: set[uuid.UUID] | None = None,
) -> PromotionResult:
    now = datetime.now(UTC)
    normalized_code = normalize_promotion_code(code)
    current_ids = set(current_promotion_ids or ())
    if current_promotion_id is not None:
        current_ids.add(current_promotion_id)
    usage_filter = (
        or_(
            ShopPromotion.max_uses.is_(None),
            ShopPromotion.used_count < ShopPromotion.max_uses,
            ShopPromotion.id.in_(current_ids),
        )
        if current_ids
        else or_(
            ShopPromotion.max_uses.is_(None),
            ShopPromotion.used_count < ShopPromotion.max_uses,
        )
    )
    base_filters = (
        ShopPromotion.is_active.is_(True),
        or_(ShopPromotion.starts_at.is_(None), ShopPromotion.starts_at <= now),
        or_(ShopPromotion.ends_at.is_(None), ShopPromotion.ends_at >= now),
        usage_filter,
    )
    if normalized_code:
        promotion = await session.scalar(
            select(ShopPromotion)
            .options(
                selectinload(ShopPromotion.target_users),
                selectinload(ShopPromotion.target_products),
            )
            .where(
                *base_filters,
                func.upper(ShopPromotion.code) == normalized_code,
                _promotion_can_target_user(user_id),
            )
            .with_for_update()
        )
        if promotion is None:
            promotion = await session.scalar(
                select(ShopPromotion)
                .options(
                    selectinload(ShopPromotion.target_users),
                    selectinload(ShopPromotion.target_products),
                )
                .where(func.upper(ShopPromotion.code) == normalized_code)
                .with_for_update()
            )
            if promotion is None:
                raise ValueError("找不到此優惠碼，請確認輸入內容後再試")
        issue = _promotion_issue(
            promotion,
            user_id=user_id,
            subtotal=subtotal,
            now=now,
            product_subtotals=product_subtotals,
            product_quantities=product_quantities,
            activity_id=activity_id,
            current_promotion_id=current_promotion_id,
            current_promotion_ids=current_ids,
        )
        if issue:
            _, reason, _, _ = issue
            raise ValueError(reason)
        amount = _discount_amount(promotion, subtotal, product_subtotals, product_quantities)
        if amount <= 0:
            if {product.id for product in (promotion.target_products or [])}:
                missing_names = [
                    product.name
                    for product in (promotion.target_products or [])
                    if product.id not in (product_subtotals or {})
                ]
                missing_label = "、".join(missing_names) or "指定商品"
                raise ValueError(f"需同時登記「{missing_label}」才能使用此優惠")
            shortfall = max(0, promotion.min_order_price - subtotal)
            raise ValueError(
                f"目前商品小計 NT${subtotal:,}，還差 NT${shortfall:,}；"
                f"消費滿 NT${promotion.min_order_price:,} 即可使用此優惠碼"
            )
        return PromotionResult(promotion=promotion, discount_amount=amount)

    promotions = (
        (
            await session.execute(
                select(ShopPromotion)
                .options(
                    selectinload(ShopPromotion.target_users),
                    selectinload(ShopPromotion.target_products),
                )
                .where(
                    *base_filters,
                    ShopPromotion.code.is_(None),
                    ShopPromotion.activity_id == activity_id,
                    _promotion_can_target_user(user_id),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    applicable = [
        promotion
        for promotion in promotions
        if _promotion_issue(
            promotion,
            user_id=user_id,
            subtotal=subtotal,
            now=now,
            product_subtotals=product_subtotals,
            product_quantities=product_quantities,
            activity_id=activity_id,
            current_promotion_id=current_promotion_id,
            current_promotion_ids=current_ids,
        )
        is None
        and _discount_amount(promotion, subtotal, product_subtotals, product_quantities) > 0
    ]
    if not applicable:
        return PromotionResult(promotion=None, discount_amount=0)
    selected = max(
        applicable,
        key=lambda promotion: _discount_amount(
            promotion, subtotal, product_subtotals, product_quantities
        ),
    )
    return PromotionResult(
        promotion=selected,
        discount_amount=_discount_amount(selected, subtotal, product_subtotals, product_quantities),
    )


async def resolve_promotions(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    subtotal: int,
    code: str | None = None,
    product_subtotals: dict[uuid.UUID, int] | None = None,
    product_quantities: dict[uuid.UUID, int] | None = None,
    activity_id: uuid.UUID | None = None,
    current_promotion_id: uuid.UUID | None = None,
    current_promotion_ids: set[uuid.UUID] | None = None,
) -> PromotionBundleResult:
    current_ids = set(current_promotion_ids or ())
    if current_promotion_id is not None:
        current_ids.add(current_promotion_id)
    selected: list[PromotionResult] = []
    if normalize_promotion_code(code):
        coupon = await resolve_promotion(
            session,
            user_id=user_id,
            subtotal=subtotal,
            code=code,
            product_subtotals=product_subtotals,
            product_quantities=product_quantities,
            activity_id=activity_id,
            current_promotion_ids=current_ids,
        )
        selected.append(coupon)

    automatic = await resolve_promotion(
        session,
        user_id=user_id,
        subtotal=subtotal,
        product_subtotals=product_subtotals,
        product_quantities=product_quantities,
        activity_id=activity_id,
        current_promotion_ids=current_ids,
    )
    if automatic.promotion is not None:
        selected.append(automatic)

    remaining = max(0, subtotal)
    allocations: list[PromotionAllocation] = []
    for result in selected:
        if result.promotion is None:
            continue
        amount = min(remaining, result.discount_amount)
        if amount > 0:
            allocations.append(PromotionAllocation(result.promotion, amount))
            remaining -= amount
    return PromotionBundleResult(tuple(allocations))


def serialize_promotion(promotion: ShopPromotion) -> ShopPromotionOut:
    target_users = list(promotion.target_users or [])
    if not target_users and promotion.target_user is not None:
        target_users = [promotion.target_user]
    return ShopPromotionOut(
        id=promotion.id,
        name=promotion.name,
        activity_id=promotion.activity_id,
        code=promotion.code,
        target_user_id=promotion.target_user_id,
        target_email=promotion.target_user.email if promotion.target_user else None,
        target_users=[
            ShopPromotionTargetOut(email=user.email, student_id=user.student_id)
            for user in target_users
        ],
        target_products=[
            ShopPromotionProductTargetOut(id=product.id, name=product.name)
            for product in (promotion.target_products or [])
        ],
        discount_type=promotion.discount_type,
        discount_value=promotion.discount_value,
        min_order_price=promotion.min_order_price,
        min_quantity=promotion.min_quantity,
        starts_at=promotion.starts_at,
        ends_at=promotion.ends_at,
        max_uses=promotion.max_uses,
        used_count=promotion.used_count,
        is_active=promotion.is_active,
        description=promotion.description,
        created_at=promotion.created_at,
        updated_at=promotion.updated_at,
    )


def serialize_public_promotion(promotion: ShopPromotion) -> ShopPromotionPublicOut:
    return ShopPromotionPublicOut(
        id=promotion.id,
        name=promotion.name,
        activity_id=promotion.activity_id,
        code=promotion.code,
        discount_type=promotion.discount_type,
        discount_value=promotion.discount_value,
        min_order_price=promotion.min_order_price,
        min_quantity=promotion.min_quantity,
        target_products=[
            ShopPromotionProductTargetOut(id=product.id, name=product.name)
            for product in (promotion.target_products or [])
        ],
        starts_at=promotion.starts_at,
        ends_at=promotion.ends_at,
        description=promotion.description,
    )
