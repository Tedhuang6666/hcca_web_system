"""用獨立 PostgreSQL 連線驗證校商事件的提交與回滾。"""

import asyncio
import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from api.core import ws_manager
from api.models.outbox import OutboxEvent
from api.models.shop import Order, OrderStatus
from api.services import outbox
from api.services.shop._events import queue_order_updated

from .test_notification_delivery_lifecycle import delivery_sessions as delivery_sessions

pytestmark = pytest.mark.asyncio


def _order() -> Order:
    return Order(id=uuid.uuid4(), user_id=uuid.uuid4(), status=OrderStatus.CONFIRMED, is_paid=True)


async def test_event_is_invisible_before_commit_and_rollback_discards_it(
    delivery_sessions, monkeypatch
):
    wake = AsyncMock()
    monkeypatch.setattr(outbox, "_enqueue_after_commit", wake)
    async with delivery_sessions() as session:
        await queue_order_updated(session, _order())
        async with delivery_sessions() as reader:
            assert list(await reader.scalars(select(OutboxEvent))) == []
        wake.assert_not_awaited()
        await session.rollback()
    await asyncio.sleep(0)
    wake.assert_not_awaited()
    async with delivery_sessions() as reader:
        assert list(await reader.scalars(select(OutboxEvent))) == []


async def test_commit_queues_both_rooms_and_dispatches_the_original_message(
    delivery_sessions, monkeypatch
):
    order = _order()
    wake = AsyncMock()
    publish = AsyncMock()
    monkeypatch.setattr(outbox, "_enqueue_after_commit", wake)
    monkeypatch.setattr(ws_manager, "publish_room_from_worker", publish)
    async with delivery_sessions.begin() as session:
        await queue_order_updated(session, order)
        wake.assert_not_awaited()
    await asyncio.sleep(0)
    wake.assert_awaited_once()
    async with delivery_sessions.begin() as reader:
        events = list(await reader.scalars(select(OutboxEvent)))
        assert {event.payload["room"] for event in events} == {
            f"user:{order.user_id}",
            "shop:orders",
        }
        for event in events:
            assert event.payload["order_id"] == str(order.id)
            await outbox._dispatch(reader, event)
            publish.assert_awaited_with(
                event.payload["room"],
                {
                    "type": "order.updated",
                    "data": {
                        "domain": "shop",
                        "order_id": str(order.id),
                        "status": "confirmed",
                        "is_paid": True,
                    },
                },
            )
            await reader.delete(event)


async def test_transport_failure_propagates_for_outbox_retry(delivery_sessions, monkeypatch):
    publish = AsyncMock(side_effect=OSError("test broker unavailable"))
    monkeypatch.setattr(ws_manager, "publish_room_from_worker", publish)
    async with delivery_sessions() as session:
        await queue_order_updated(session, _order())
        event = (await session.scalars(select(OutboxEvent))).first()
        with pytest.raises(OSError, match="broker unavailable"):
            await outbox._dispatch(session, event)
        await session.rollback()
