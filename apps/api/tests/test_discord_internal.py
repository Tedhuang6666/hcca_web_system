"""獨立 Discord Bot internal API 契約測試。"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

from api.models.discord_account import DiscordAccountLink
from api.models.outbox import OutboxEvent, OutboxStatus
from api.models.user import User
from api.services import api_key as api_key_svc
from api.services import discord_gateway
from api.services.outbox import emit


async def _bot_key(db_session) -> str:
    owner = User(
        email="discord-bot-owner@example.com",
        display_name="Discord Bot Owner",
        is_active=True,
        is_verified=True,
    )
    db_session.add(owner)
    await db_session.flush()
    _row, raw = await api_key_svc.create_api_key(
        db_session,
        owner_user_id=owner.id,
        name="Discord Bot",
        scopes=["discord:bot"],
        rate_limit_per_minute=120,
        expires_at=None,
    )
    return raw


async def test_claim_discord_event_requires_api_key(client):
    response = await client.get("/internal/discord/events/claim", params={"wait_seconds": 0})
    assert response.status_code == 401


async def test_discord_bot_status_verifies_remote_connection(client, db_session):
    raw_key = await _bot_key(db_session)

    response = await client.get(
        "/internal/discord/status",
        headers={"X-API-Key": raw_key},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["server_time"]


async def test_claim_and_ack_discord_event(client, db_session, monkeypatch):
    raw_key = await _bot_key(db_session)
    event = await emit(
        db_session,
        event_type="discord.channel_alert",
        payload={"channel_id": "123", "title": "測試"},
    )
    monkeypatch.setattr(discord_gateway.redis_client, "set", AsyncMock(return_value=True))
    monkeypatch.setattr(discord_gateway.redis_client, "delete", AsyncMock(return_value=1))

    response = await client.get(
        "/internal/discord/events/claim",
        params={"wait_seconds": 0},
        headers={"X-API-Key": raw_key},
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": str(event.id),
        "event_type": "discord.channel_alert",
        "payload": {"channel_id": "123", "title": "測試"},
    }
    assert event.status == OutboxStatus.PENDING

    response = await client.post(
        f"/internal/discord/events/{event.id}/ack",
        headers={"X-API-Key": raw_key},
        json={"success": True, "result": {}},
    )

    assert response.status_code == 204
    await db_session.refresh(event)
    assert event.status == OutboxStatus.PROCESSED
    assert event.processed_at is not None


async def test_ack_rejects_non_discord_event(client, db_session, monkeypatch):
    raw_key = await _bot_key(db_session)
    event = OutboxEvent(
        event_type="email.send",
        payload={},
        status=OutboxStatus.PENDING,
        created_at=datetime.now(UTC),
    )
    db_session.add(event)
    await db_session.flush()
    monkeypatch.setattr(discord_gateway.redis_client, "delete", AsyncMock(return_value=1))

    response = await client.post(
        f"/internal/discord/events/{event.id}/ack",
        headers={"X-API-Key": raw_key},
        json={"success": True, "result": {}},
    )

    assert response.status_code == 404
    assert event.status == OutboxStatus.PENDING


async def test_command_context_resolves_bound_user(client, db_session):
    raw_key = await _bot_key(db_session)
    user = User(
        email="linked@example.com",
        display_name="已綁定成員",
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        DiscordAccountLink(
            user_id=user.id,
            discord_user_id="123456789",
            is_active=True,
        )
    )
    await db_session.flush()

    response = await client.post(
        "/internal/discord/commands/context",
        headers={"X-API-Key": raw_key},
        json={
            "discord_user_id": "123456789",
            "interaction_id": "987654321",
            "guild_id": "111",
            "arguments": {},
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["display_name"] == "已綁定成員"
    assert response.json()["data"]["email"] == "linked@example.com"


async def test_inventory_update_uses_bot_scope(client, db_session, monkeypatch):
    raw_key = await _bot_key(db_session)
    set_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(discord_gateway.redis_client, "set", set_mock)

    response = await client.put(
        "/internal/discord/inventory",
        headers={"X-API-Key": raw_key},
        json={
            "bot_user_id": "123",
            "bot_username": "HCCA Bot",
            "latency_ms": 25.5,
            "guilds": [],
        },
    )

    assert response.status_code == 204
    set_mock.assert_awaited_once()
