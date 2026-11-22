"""保存班級尾款每次實際入帳的差額。"""

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order
from api.models.shop_class_collection import ShopClassCollection


def record_class_collection(
    session: AsyncSession,
    order: Order,
    *,
    amount: int,
    actor_id: uuid.UUID | None,
    collected_at: datetime | None = None,
) -> None:
    if order.is_class_balance and amount:
        session.add(
            ShopClassCollection(
                order_id=order.id,
                amount=amount,
                collected_at=collected_at or datetime.now(UTC),
                actor_id=actor_id,
            )
        )
