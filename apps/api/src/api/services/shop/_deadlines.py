"""商品訂購截止提醒。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Product, ProductStatus


async def recently_closed_product_ids(session: AsyncSession, *, now: datetime) -> list[uuid.UUID]:
    """取得最近六分鐘內到達單品截止時間的商品。"""
    result = await session.scalars(
        select(Product.id).where(
            Product.status != ProductStatus.TESTING,
            Product.sale_end > now - timedelta(minutes=6),
            Product.sale_end <= now,
        )
    )
    return list(result.all())
