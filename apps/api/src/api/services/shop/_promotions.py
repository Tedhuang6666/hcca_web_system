"""校商優惠與優惠碼服務。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import ShopDiscountType, ShopPromotion
from api.models.user import User
from api.schemas.shop import ShopPromotionCreate, ShopPromotionOut, ShopPromotionUpdate
from api.services._base import apply_updates


@dataclass(frozen=True)
class PromotionResult:
    promotion: ShopPromotion | None
    discount_amount: int


def normalize_promotion_code(code: str | None) -> str | None:
    normalized = code.strip().upper() if code else None
    return normalized or None


def _validate_discount(discount_type: ShopDiscountType, discount_value: int) -> None:
    if discount_type == ShopDiscountType.PERCENTAGE and discount_value > 100:
        raise ValueError("百分比優惠必須介於 1 到 100")


async def _target_user(session: AsyncSession, target_email: str | None) -> User | None:
    if not target_email:
        return None
    normalized = target_email.strip().lower()
    if "@" not in normalized:
        raise ValueError("指定帳號必須填寫有效 Email")
    user = await session.scalar(select(User).where(func.lower(User.email) == normalized))
    if user is None:
        raise ValueError("找不到指定的帳號")
    return user


def _validate_target(code: str | None, target_user: User | None) -> None:
    if code is None and target_user is None:
        raise ValueError("請指定帳號或設定優惠碼")


async def create_promotion(
    session: AsyncSession, *, data: ShopPromotionCreate, created_by: uuid.UUID
) -> ShopPromotion:
    code = normalize_promotion_code(data.code)
    target_user = await _target_user(session, data.target_email)
    _validate_target(code, target_user)
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
        target_user_id=target_user.id if target_user else None,
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
    await session.refresh(promotion, attribute_names=["target_user"])
    return promotion


async def list_promotions(
    session: AsyncSession, *, include_inactive: bool = False
) -> list[ShopPromotion]:
    query = select(ShopPromotion).options(selectinload(ShopPromotion.target_user))
    if not include_inactive:
        query = query.where(ShopPromotion.is_active.is_(True))
    query = query.order_by(ShopPromotion.created_at.desc())
    return list((await session.execute(query)).scalars().all())


async def get_promotion(session: AsyncSession, promotion_id: uuid.UUID) -> ShopPromotion | None:
    return await session.scalar(
        select(ShopPromotion)
        .options(selectinload(ShopPromotion.target_user))
        .where(ShopPromotion.id == promotion_id)
    )


async def update_promotion(
    session: AsyncSession, promotion: ShopPromotion, *, data: ShopPromotionUpdate
) -> ShopPromotion:
    payload = data.model_dump(exclude_unset=True)
    target_email = payload.pop("target_email", None) if "target_email" in payload else None
    if "code" in payload:
        payload["code"] = normalize_promotion_code(payload["code"])
        if payload["code"] and await session.scalar(
            select(ShopPromotion.id).where(
                func.upper(ShopPromotion.code) == payload["code"],
                ShopPromotion.id != promotion.id,
            )
        ):
            raise ValueError("優惠碼已存在")
    if target_email is not None or "target_email" in data.model_fields_set:
        target_user = await _target_user(session, target_email)
        payload["target_user_id"] = target_user.id if target_user else None
    apply_updates(promotion, payload)
    _validate_target(
        promotion.code,
        await session.get(User, promotion.target_user_id) if promotion.target_user_id else None,
    )
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
            .where(
                *base_filters,
                func.upper(ShopPromotion.code) == normalized_code,
                or_(
                    ShopPromotion.target_user_id.is_(None), ShopPromotion.target_user_id == user_id
                ),
            )
            .with_for_update()
        )
        if promotion is None:
            raise ValueError("優惠碼無效、已過期或不適用於此帳號")
        amount = _discount_amount(promotion, subtotal)
        if amount <= 0:
            raise ValueError("此優惠碼未達使用門檻")
        return PromotionResult(promotion=promotion, discount_amount=amount)

    promotions = (
        (
            await session.execute(
                select(ShopPromotion)
                .where(
                    *base_filters,
                    ShopPromotion.code.is_(None),
                    ShopPromotion.target_user_id == user_id,
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
    return ShopPromotionOut(
        id=promotion.id,
        name=promotion.name,
        code=promotion.code,
        target_user_id=promotion.target_user_id,
        target_email=promotion.target_user.email if promotion.target_user else None,
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
