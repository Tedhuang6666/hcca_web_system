"""Typed client for the platform's Discord internal API."""

from __future__ import annotations

import uuid
from typing import Any

import httpx


class PlatformCommandError(RuntimeError):
    pass


class PlatformApiClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"X-API-Key": api_key},
            timeout=httpx.Timeout(30.0, connect=5.0),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def claim_event(self) -> dict[str, Any] | None:
        response = await self._client.get(
            "/internal/discord/events/claim",
            params={"wait_seconds": 20},
        )
        if response.status_code == 204:
            return None
        response.raise_for_status()
        return response.json()

    async def acknowledge_event(
        self,
        event_id: uuid.UUID,
        *,
        success: bool,
        error: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        response = await self._client.post(
            f"/internal/discord/events/{event_id}/ack",
            json={
                "success": success,
                "error": error,
                "result": result or {},
            },
        )
        response.raise_for_status()

    async def member_joined(
        self,
        *,
        guild_id: int,
        discord_user_id: int,
        display_name: str,
    ) -> None:
        response = await self._client.post(
            "/internal/discord/members/joined",
            json={
                "guild_id": str(guild_id),
                "discord_user_id": str(discord_user_id),
                "display_name": display_name,
            },
        )
        response.raise_for_status()

    async def update_inventory(self, payload: dict[str, Any]) -> None:
        response = await self._client.put("/internal/discord/inventory", json=payload)
        response.raise_for_status()

    async def command(
        self,
        operation: str,
        *,
        discord_user_id: int,
        interaction_id: int,
        guild_id: int | None,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await self._client.post(
            f"/internal/discord/commands/{operation}",
            json={
                "discord_user_id": str(discord_user_id),
                "interaction_id": str(interaction_id),
                "guild_id": str(guild_id) if guild_id else None,
                "arguments": arguments or {},
            },
        )
        if response.status_code == 409:
            raise PlatformCommandError(str(response.json().get("detail") or "平台操作失敗"))
        response.raise_for_status()
        return response.json()["data"]
