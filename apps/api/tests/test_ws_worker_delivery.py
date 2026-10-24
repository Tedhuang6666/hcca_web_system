"""背景通知經真正 Redis 發布至 API 頻道，不需啟動 API listener。"""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
import redis.asyncio as aioredis
from redis.exceptions import ConnectionError as RedisConnectionError

from api.core import ws_manager
from api.core.config import settings


async def test_worker_publishes_to_api_channel_without_lifespan(monkeypatch):
    monkeypatch.setattr(settings, "WS_PUBSUB_BACKEND", "redis")
    monkeypatch.setattr(ws_manager, "_broker", None)
    room = f"test-worker:{uuid.uuid4().hex}"
    message = {"type": "notification.created", "notification": {"id": uuid.uuid4().hex}}
    async with (
        aioredis.from_url(
            str(settings.REDIS_REALTIME_URL or settings.REDIS_URL), decode_responses=True
        ) as subscriber,
        subscriber.pubsub() as subscription,
    ):
        await subscription.subscribe(ws_manager._PUBSUB_CHANNEL)
        acknowledgement = await subscription.get_message(timeout=3)
        assert acknowledgement is not None and acknowledgement["type"] == "subscribe"
        await ws_manager.publish_room_from_worker(room, message)
        async with asyncio.timeout(3):
            while True:
                received = await subscription.get_message(ignore_subscribe_messages=True, timeout=1)
                if received is not None:
                    payload = json.loads(received["data"])
                    if payload.get("room") == room:
                        break
        assert payload == {"target": "room", "room": room, "message": message}


async def test_worker_redis_failure_propagates_for_outbox_retry(monkeypatch, unused_tcp_port):
    monkeypatch.setattr(settings, "WS_PUBSUB_BACKEND", "redis")
    monkeypatch.setattr(settings, "REDIS_REALTIME_URL", f"redis://127.0.0.1:{unused_tcp_port}/0")
    monkeypatch.setattr(settings, "REDIS_SOCKET_TIMEOUT", 1)
    with pytest.raises(RedisConnectionError):
        await ws_manager.publish_room_from_worker("test-worker", {"type": "notification.created"})
