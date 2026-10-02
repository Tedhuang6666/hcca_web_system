"""校商優惠與優惠碼服務。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import ShopDiscountType, ShopPromotion
from api.models.user import User
from api.schemas.shop import (
    ShopPromotionCreate,
    ShopPromotionOut,
    ShopPromotionTargetOut,
    ShopPromotionUpdate,
)
from api.services._base import apply_updates


@dataclass(frozen=True)
class PromotionResult:
    promotion: ShopPromotion | None
    discount_amount: int


@dataclass(frozen=True)
class PromotionPreviewResult:
    promotion: ShopPromotion | None
    eligible: bool
    discount_amount: int
    reason_code: str
    reason: str | None = None
    shortfall: int = 0


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


def _validate_target(code: str | None, target_users: list[User]) -> None:
    if code is None and not target_users:
        raise ValueError("請指定帳號或設定優惠碼")


def _promotion_targets_user(user_id: uuid.UUID):
    return or_(
        ShopPromotion.target_user_id == user_id,
        ShopPromotion.target_users.any(User.id == user_id),
    )


def _promotion_allows_user(promotion: ShopPromotion, user_id: uuid.UUID) -> bool:
    targets = list(promotion.target_users or [])
    if promotion.target_user_id is None and not targets:
        return True
    return promotion.target_user_id == user_id or any(user.id == user_id for user in targets)


def _promotion_issue(
    promotion: ShopPromotion,
    *,
    user_id: uuid.UUID,
    subtotal: int,
    now: datetime,
) -> tuple[str, str, int] | None:
    if not promotion.is_active:
        return "inactive", "此優惠目前未開放使用。", 0
    if promotion.starts_at and promotion.starts_at > now:
        start = promotion.starts_at.astimezone(UTC).strftime("%Y/%m/%d %H:%M")
        return "not_started", f"此優惠將於 {start} 開始。", 0
    if promotion.ends_at and promotion.ends_at < now:
        return "expired", "此優惠已結束。", 0
    if promotion.max_uses is not None and promotion.used_count >= promotion.max_uses:
        return "usage_limit", "此優惠已達可使用次數上限。", 0
    if not _promotion_allows_user(promotion, user_id):
        return "account_not_eligible", "此優惠碼限符合資格的帳號使用，您的帳號目前不符合資格。", 0
    if subtotal < promotion.min_order_price:
        shortfall = promotion.min_order_price - subtotal
        reason = (
            f"目前商品小計 NT${subtotal:,}，還差 NT${shortfall:,}；"
            f"消費滿 NT${promotion.min_order_price:,} 即可使用。"
        )
        return "minimum_not_met", reason, shortfall
    return None


async def preview_promotion(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    subtotal: int,
    code: str | None = None,
) -> PromotionPreviewResult:
    now = datetime.now(UTC)
    normalized_code = normalize_promotion_code(code)
    load_targets = selectinload(ShopPromotion.target_users)

    if normalized_code:
        promotion = await session.scalar(
            select(ShopPromotion)
            .options(load_targets)
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
        issue = _promotion_issue(promotion, user_id=user_id, subtotal=subtotal, now=now)
        if issue:
            reason_code, reason, shortfall = issue
            return PromotionPreviewResult(
                promotion=promotion,
                eligible=False,
                discount_amount=0,
                reason_code=reason_code,
                reason=reason,
                shortfall=shortfall,
            )
        amount = _discount_amount(promotion, subtotal)
        return PromotionPreviewResult(
            promotion=promotion,
            eligible=amount > 0,
            discount_amount=amount,
            reason_code="applied" if amount > 0 else "minimum_not_met",
            reason=f"已套用「{promotion.name}」，共省下 NT${amount:,}。"
            if amount
            else "此優惠目前無法折抵。",
        )

    base_filters = (
        ShopPromotion.is_active.is_(True),
        or_(ShopPromotion.starts_at.is_(None), ShopPromotion.starts_at <= now),
        or_(ShopPromotion.ends_at.is_(None), ShopPromotion.ends_at >= now),
        or_(ShopPromotion.max_uses.is_(None), ShopPromotion.used_count < ShopPromotion.max_uses),
        ShopPromotion.code.is_(None),
        _promotion_targets_user(user_id),
    )
    promotions = list(
        (await session.execute(select(ShopPromotion).options(load_targets).where(*base_filters)))
        .scalars()
        .all()
    )
    eligible = [promotion for promotion in promotions if _discount_amount(promotion, subtotal) > 0]
    if eligible:
        selected = max(eligible, key=lambda promotion: _discount_amount(promotion, subtotal))
        amount = _discount_amount(selected, subtotal)
        return PromotionPreviewResult(
            promotion=selected,
            eligible=True,
            discount_amount=amount,
            reason_code="applied",
            reason=f"已自動套用「{selected.name}」，共省下 NT${amount:,}。",
        )

    below_minimum = [promotion for promotion in promotions if subtotal < promotion.min_order_price]
    if below_minimum:
        selected = min(below_minimum, key=lambda promotion: promotion.min_order_price - subtotal)
        issue = _promotion_issue(selected, user_id=user_id, subtotal=subtotal, now=now)
        if issue:
            reason_code, reason, shortfall = issue
            return PromotionPreviewResult(
                promotion=selected,
                eligible=False,
                discount_amount=0,
                reason_code=reason_code,
                reason=reason,
                shortfall=shortfall,
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
    _validate_target(code, target_users)
    _validate_discount(data.discount_type, data.discount_value)
    if data.starts_at and data.ends_at and data.starts_at >= data.ends_at:
        raise ValueError("優惠開始時間必須早於結束時間")
    if code and await session.scalar(
        select(ShopPromotion.id).where(func.upper(ShopPromotion.code) == code)
    ):
        raise ValueError("優惠碼已存在")

    promotion = ShopPromotion(
        name=data.name.strip(),
        code=code,
        target_user_id=target_users[0].id if len(target_users) == 1 else None,
        target_users=target_users,
        discount_type=data.discount_type,
        discount_value=data.discount_value,
        min_order_price=data.min_order_price,
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
    )
    if not include_inactive:
        query = query.where(ShopPromotion.is_active.is_(True))
    query = query.order_by(ShopPromotion.created_at.desc())
    return list((await session.execute(query)).scalars().all())


async def get_promotion(session: AsyncSession, promotion_id: uuid.UUID) -> ShopPromotion | None:
    return await session.scalar(
        select(ShopPromotion)
        .options(
            selectinload(ShopPromotion.target_user),
            selectinload(ShopPromotion.target_users),
        )
        .where(ShopPromotion.id == promotion_id)
    )


async def update_promotion(
    session: AsyncSession, promotion: ShopPromotion, *, data: ShopPromotionUpdate
) -> ShopPromotion:
    payload = data.model_dump(exclude_unset=True)
    target_users: list[User] | None = None
    if "target_identifiers" in payload or "target_email" in payload:
        identifiers = payload.pop("target_identifiers", None)
        target_email = payload.pop("target_email", None)
        if identifiers is None:
            identifiers = []
        if target_email:
            identifiers = [*identifiers, target_email]
        target_users = await _target_users(session, identifiers)
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
    apply_updates(promotion, payload)
    _validate_target(promotion.code, list(promotion.target_users))
    _validate_discount(promotion.discount_type, promotion.discount_value)
    if promotion.starts_at and promotion.ends_at and promotion.starts_at >= promotion.ends_at:
        raise ValueError("優惠開始時間必須早於結束時間")
    await session.flush()
    await session.refresh(promotion, attribute_names=["target_user"])
    return promotion


def _discount_amount(promotion: ShopPromotion, subtotal: int) -> int:
    if subtotal < promotion.min_order_price:
        return 0
    if promotion.discount_type == ShopDiscountType.PERCENTAGE:
        return min(subtotal, subtotal * promotion.discount_value // 100)
    return min(subtotal, promotion.discount_value)


async def resolve_promotion(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    subtotal: int,
    code: str | None = None,
) -> PromotionResult:
    now = datetime.now(UTC)
    normalized_code = normalize_promotion_code(code)
    base_filters = (
        ShopPromotion.is_active.is_(True),
        or_(ShopPromotion.starts_at.is_(None), ShopPromotion.starts_at <= now),
        or_(ShopPromotion.ends_at.is_(None), ShopPromotion.ends_at >= now),
        or_(ShopPromotion.max_uses.is_(None), ShopPromotion.used_count < ShopPromotion.max_uses),
    )
    if normalized_code:
        promotion = await session.scalar(
            select(ShopPromotion)
            .options(selectinload(ShopPromotion.target_users))
            .where(
                *base_filters,
                func.upper(ShopPromotion.code) == normalized_code,
                or_(
                    and_(
                        ShopPromotion.target_user_id.is_(None),
                        ~ShopPromotion.target_users.any(),
                    ),
                    _promotion_targets_user(user_id),
                ),
            )
            .with_for_update()
        )
        if promotion is None:
            promotion = await session.scalar(
                select(ShopPromotion)
                .options(selectinload(ShopPromotion.target_users))
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
            )
            if issue:
                _, reason, _ = issue
                raise ValueError(reason)
        amount = _discount_amount(promotion, subtotal)
        if amount <= 0:
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
                .where(
                    *base_filters,
                    ShopPromotion.code.is_(None),
                    _promotion_targets_user(user_id),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    applicable = [p for p in promotions if _discount_amount(p, subtotal) > 0]
    if not applicable:
        return PromotionResult(promotion=None, discount_amount=0)
    selected = max(applicable, key=lambda p: _discount_amount(p, subtotal))
    return PromotionResult(promotion=selected, discount_amount=_discount_amount(selected, subtotal))


def serialize_promotion(promotion: ShopPromotion) -> ShopPromotionOut:
    target_users = list(promotion.target_users or [])
    if not target_users and promotion.target_user is not None:
        target_users = [promotion.target_user]
    return ShopPromotionOut(
        id=promotion.id,
        name=promotion.name,
        code=promotion.code,
        target_user_id=promotion.target_user_id,
        target_email=promotion.target_user.email if promotion.target_user else None,
        target_users=[
            ShopPromotionTargetOut(email=user.email, student_id=user.student_id)
            for user in target_users
        ],
        discount_type=promotion.discount_type,
        discount_value=promotion.discount_value,
        min_order_price=promotion.min_order_price,
        starts_at=promotion.starts_at,
        ends_at=promotion.ends_at,
        max_uses=promotion.max_uses,
        used_count=promotion.used_count,
        is_active=promotion.is_active,
        description=promotion.description,
        created_at=promotion.created_at,
        updated_at=promotion.updated_at,
    )
