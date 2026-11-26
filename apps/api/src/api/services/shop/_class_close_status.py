"""商品分類結單與收款狀態查詢。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TypedDict

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import Order, OrderStatus, ShopOrderClose
from api.models.shop_class_payment import ShopClassPayment
from api.schemas.shop import CloseStatusItem, ShopOrderCloseOut


async def get_close_status(
    session: AsyncSession,
    category_ids: list[uuid.UUID],
    class_id: uuid.UUID | None,
) -> dict[uuid.UUID, CloseStatusItem | None]:
    """班聯結單優先；班級收款確認會鎖定該班所有分類。"""
    if not category_ids:
        return {}

    payment = None
    if class_id is not None:
        payment = await session.scalar(
            select(ShopClassPayment).where(
                ShopClassPayment.class_id == class_id,
                ShopClassPayment.is_paid.is_(True),
            )
        )

    close_query = (
        select(ShopOrderClose)
        .options(selectinload(ShopOrderClose.closed_by))
        .where(
            ShopOrderClose.is_active.is_(True),
            ShopOrderClose.category_id.in_(category_ids),
            or_(ShopOrderClose.class_id.is_(None), ShopOrderClose.class_id == class_id),
            or_(ShopOrderClose.closes_at.is_(None), ShopOrderClose.closes_at <= datetime.now(UTC)),
        )
    )
    rows = (await session.execute(close_query)).scalars().all()
    result: dict[uuid.UUID, CloseStatusItem | None] = {cid: None for cid in category_ids}

    if payment is not None:
        for category_id in category_ids:
            result[category_id] = CloseStatusItem(
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
    """取得班級各商品分類最近的代收與班聯確認時間。"""
    details = {
        category_id: CloseStatusCollectionDetails(
            class_collected_at=None,
            council_confirmed_at=None,
        )
        for category_id in category_ids
    }
    if not category_ids or class_id is None:
        return details

    collected_rows = await session.execute(
        select(Order.category_id, func.max(Order.class_collected_at))
        .where(
            Order.class_id == class_id,
            Order.category_id.in_(category_ids),
            Order.is_class_collected.is_(True),
            Order.class_collected_at.is_not(None),
            Order.status.not_in((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
        )
        .group_by(Order.category_id)
    )
    for category_id, collected_at in collected_rows:
        if category_id in details:
            details[category_id]["class_collected_at"] = collected_at

    payment = await session.scalar(
        select(ShopClassPayment).where(
            ShopClassPayment.class_id == class_id,
            ShopClassPayment.is_paid.is_(True),
        )
    )
    if payment is not None:
        for category_id in category_ids:
            details[category_id]["council_confirmed_at"] = payment.confirmed_at
    return details


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
