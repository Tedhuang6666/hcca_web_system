"""班級層級的商店收款確認。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop_class_payment import ShopClassPayment


async def class_payment_for_scope(
    session: AsyncSession, class_id: uuid.UUID
) -> ShopClassPayment | None:
    return await session.scalar(
        select(ShopClassPayment).where(
            ShopClassPayment.class_id == class_id,
            ShopClassPayment.is_paid.is_(True),
        )
    )
