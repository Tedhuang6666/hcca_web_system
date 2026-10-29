"""獨立收款訂單的繳費通知，與訂單異動在同一交易保存。"""

from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import TAIPEI
from api.models.shop import Order, OrderStatus
from api.models.user import User
from api.services.outbox import emit, request_processing_after_commit


async def queue_individual_payment_notice(
    session: AsyncSession,
    order: Order,
    *,
    reason: Literal["supplement_created", "separated_from_class"],
    due_at: datetime | None = None,
) -> None:
    if (
        order.class_id is not None
        or order.is_paid
        or order.total_price <= 0
        or order.test_product_id is not None
        or order.status in (OrderStatus.CANCELLED, OrderStatus.REFUNDED)
    ):
        return
    buyer = await session.get(User, order.user_id)
    if buyer is None or not buyer.email:
        return
    deadline = None
    if due_at is not None:
        due_at = due_at if due_at.tzinfo else due_at.replace(tzinfo=UTC)
        deadline = due_at.astimezone(TAIPEI).strftime("%Y/%m/%d %H:%M（台北時間）")
    await emit(
        session,
        event_type="shop.order_payment_required",
        payload={
            "order_id": str(order.id),
            "serial_number": order.serial_number,
            "buyer_email": buyer.email,
            "buyer_name": buyer.display_name or "同學",
            "total_price": order.total_price,
            "reason": reason,
            "payment_deadline": deadline,
        },
    )
    request_processing_after_commit(session)
