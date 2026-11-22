"""班級與活動的結單狀態及收款狀態查詢。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TypedDict

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import (
    Order,
    OrderStatus,
    ProductCategory,
    ShopOrderClose,
)
from api.models.shop_class_payment import ShopClassPayment
from api.schemas.shop import CloseStatusItem, ShopOrderCloseOut
from api.services.shop._class_payment_scope import paid_general_category_ids


async def get_close_status(
    session: AsyncSession,
    category_ids: list[uuid.UUID],
    class_id: uuid.UUID | None,
) -> dict[uuid.UUID, CloseStatusItem | None]:
    """班聯結單優先；班級期限及繳款狀態限制學生自行訂購。"""
    if not category_ids:
        return {}
    categories = list(
        await session.scalars(
            select(ProductCategory)
            .where(ProductCategory.id.in_(category_ids))
            .options(selectinload(ProductCategory.activity))
        )
    )
    payments = (
        list(
            await session.scalars(
                select(ShopClassPayment).where(
                    ShopClassPayment.class_id == class_id,
                    ShopClassPayment.is_paid.is_(True),
                )
            )
        )
        if class_id is not None
        else []
    )
    paid_scopes = {payment.activity_id: payment for payment in payments}
    paid_categories = (
        await paid_general_category_ids(session, class_id)
        if class_id is not None and None in paid_scopes
        else set()
    )
    q = (
        select(ShopOrderClose)
        .options(selectinload(ShopOrderClose.closed_by))
        .where(
            ShopOrderClose.is_active.is_(True),
            ShopOrderClose.category_id.in_(category_ids),
            or_(ShopOrderClose.class_id.is_(None), ShopOrderClose.class_id == class_id),
        )
    )
    q = q.where(
        or_(ShopOrderClose.closes_at.is_(None), ShopOrderClose.closes_at <= datetime.now(UTC))
    )
    rows = (await session.execute(q)).scalars().all()
    result: dict[uuid.UUID, CloseStatusItem | None] = {cid: None for cid in category_ids}
    for category in categories:
        activity = category.activity
        deadline = activity.order_closes_at if activity else None
        if deadline is not None and deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=UTC)
        if activity and (activity.order_closed_at or (deadline and deadline <= datetime.now(UTC))):
            result[category.id] = CloseStatusItem(
                is_closed=True,
                is_global=True,
                closes_at=deadline,
                closed_at=activity.order_closed_at or deadline,
            )
        elif (category.activity_id is not None or category.id in paid_categories) and (
            payment := paid_scopes.get(category.activity_id)
        ):
            result[category.id] = CloseStatusItem(
                is_closed=True,
                closed_at=payment.confirmed_at,
            )
    for row in rows:
        if row.class_id is not None and result[row.category_id] is not None:
            continue
        result[row.category_id] = CloseStatusItem(
            is_closed=True,
            is_global=row.class_id is None,
            closed_at=row.created_at,
            closes_at=row.closes_at,
            closed_by_name=row.closed_by.display_name if row.closed_by else None,
        )
    return result


class CloseStatusCollectionDetails(TypedDict):
    class_collected_at: datetime | None
    council_confirmed_at: datetime | None


async def get_close_status_collection_details(
    session: AsyncSession,
    category_ids: list[uuid.UUID],
    class_id: uuid.UUID | None,
) -> dict[uuid.UUID, CloseStatusCollectionDetails]:
    """Return the latest collection and council confirmation times for one class."""
    result = {
        category_id: CloseStatusCollectionDetails(
            class_collected_at=None,
            council_confirmed_at=None,
        )
        for category_id in category_ids
    }
    if not category_ids or class_id is None:
        return result

    categories = list(
        await session.scalars(select(ProductCategory).where(ProductCategory.id.in_(category_ids)))
    )
    activity_ids = {category.activity_id for category in categories if category.activity_id}
    category_activity = {category.id: category.activity_id for category in categories}

    collected_scopes: dict[uuid.UUID, datetime] = {}
    collected_categories: dict[uuid.UUID, datetime] = {}
    scope_filters = [Order.category_id.in_(category_ids)]
    if activity_ids:
        scope_filters.append(Order.activity_id.in_(activity_ids))
    collected_rows = await session.execute(
        select(Order.activity_id, Order.category_id, func.max(Order.class_collected_at))
        .where(
            Order.class_id == class_id,
            Order.is_class_collected.is_(True),
            Order.class_collected_at.is_not(None),
            Order.status.not_in((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
            or_(*scope_filters),
        )
        .group_by(Order.activity_id, Order.category_id)
    )
    for activity_id, category_id, collected_at in collected_rows:
        if collected_at is None:
            continue
        if activity_id in activity_ids:
            current = collected_scopes.get(activity_id)
            if current is None or collected_at > current:
                collected_scopes[activity_id] = collected_at
        elif category_id in category_activity:
            scoped_activity_id = category_activity[category_id]
            target = collected_scopes if scoped_activity_id else collected_categories
            key = scoped_activity_id or category_id
            current = target.get(key)
            if current is None or collected_at > current:
                target[key] = collected_at

    payments = await session.scalars(
        select(ShopClassPayment).where(
            ShopClassPayment.class_id == class_id,
            ShopClassPayment.is_paid.is_(True),
        )
    )
    confirmation_times = {
        payment.activity_id: payment.confirmed_at
        for payment in payments
        if payment.confirmed_at is not None
    }
    paid_categories = (
        await paid_general_category_ids(session, class_id) if None in confirmation_times else set()
    )

    for category in categories:
        result[category.id] = CloseStatusCollectionDetails(
            class_collected_at=(
                collected_scopes.get(category.activity_id)
                if category.activity_id
                else collected_categories.get(category.id)
            )
            or collected_categories.get(category.id),
            council_confirmed_at=(
                confirmation_times.get(category.activity_id)
                if category.activity_id is not None or category.id in paid_categories
                else None
            ),
        )
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
