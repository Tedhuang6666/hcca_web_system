"""活動的商品訂購期限。"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity
from api.models.shop import Product, ProductCategory, ProductSeries, ProductStatus


async def set_activity_order_closure(
    session: AsyncSession, activity_id: uuid.UUID, *, is_closed: bool
) -> Activity | None:
    """只鎖定訂購，保留活動、商品、訂單與收款資料。"""
    activity = await session.scalar(
        select(Activity)
        .where(Activity.id == activity_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if activity is not None:
        if is_closed:
            activity.order_closed_at = activity.order_closed_at or datetime.now(UTC)
        else:
            activity.order_closed_at = None
        await session.flush()
    return activity


async def set_activity_order_deadline(
    session: AsyncSession, activity_id: uuid.UUID, *, closes_at: datetime | None
) -> Activity | None:
    activity = await session.get(Activity, activity_id)
    if activity is not None:
        activity.order_closes_at = closes_at
        await session.flush()
    return activity


async def recently_closed_product_ids(session: AsyncSession, *, now: datetime) -> list[uuid.UUID]:
    """單品提前截止或班聯統一期限到達時通知。"""
    deadline = case(
        (Activity.order_closes_at.is_(None), Product.sale_end),
        (Product.sale_end.is_(None), Activity.order_closes_at),
        (Product.sale_end < Activity.order_closes_at, Product.sale_end),
        else_=Activity.order_closes_at,
    )
    result = await session.scalars(
        select(Product.id)
        .outerjoin(ProductSeries, Product.series_id == ProductSeries.id)
        .outerjoin(
            ProductCategory,
            ProductCategory.id == func.coalesce(Product.category_id, ProductSeries.category_id),
        )
        .outerjoin(Activity, ProductCategory.activity_id == Activity.id)
        .where(
            Product.status != ProductStatus.TESTING,
            deadline > now - timedelta(minutes=6),
            deadline <= now,
        )
    )
    return list(result.all())
