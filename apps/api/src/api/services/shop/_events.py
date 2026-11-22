"""訂單變更事件與業務異動共用交易，由 outbox 在提交後發布。"""

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order
from api.services.outbox import emit, request_processing_after_commit


async def queue_order_updated(session: AsyncSession, order: Order) -> None:
    message = {
        "type": "order.updated",
        "data": {
            "domain": "shop",
            "order_id": str(order.id),
            "status": order.status.value,
            "is_paid": order.is_paid,
        },
    }
    for room in (f"user:{order.user_id}", "shop:orders"):
        await emit(
            session,
            event_type="realtime.room",
            payload={"order_id": str(order.id), "room": room, "message": message},
        )
    request_processing_after_commit(session)
