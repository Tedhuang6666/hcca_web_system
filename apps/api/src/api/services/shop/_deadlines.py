"""活動的商品訂購期限。"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity
from api.models.shop import Product, ProductCategory, ProductSeries, ProductStatus


async def set_activity_order_deadline(
    session: AsyncSession, activity_id: uuid.UUID, *, closes_at: datetime | None
) -> Activity | None:
    activity = await session.get(Activity, activity_id)
    if activity is not None:
        activity.order_closes_at = closes_at
        await session.flush()
    return activity


async def recently_closed_product_ids(session: AsyncSession, *, now: datetime) -> list[uuid.UUID]:
    """通知沿用同一有效期限，已延長的品項不提前通知結單。"""
    deadline = func.coalesce(Product.sale_end, Activity.order_closes_at)
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
