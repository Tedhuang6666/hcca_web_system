"""Typed client for the platform's Discord internal API."""

from __future__ import annotations

import uuid
from typing import Any

import httpx


class PlatformCommandError(RuntimeError):
    pass


class PlatformUnavailableError(RuntimeError):
    pass


class PlatformApiClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        cf_access_client_id: str = "",
        cf_access_client_secret: str = "",
    ) -> None:
        headers = {
            "X-API-Key": api_key,
            "User-Agent": "hcca-discord-bot/1.0",
        }
        if cf_access_client_id and cf_access_client_secret:
            headers["CF-Access-Client-Id"] = cf_access_client_id
            headers["CF-Access-Client-Secret"] = cf_access_client_secret
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(30.0, connect=5.0),
        )

    async def close(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise PlatformUnavailableError(f"平台 API 回應 HTTP {response.status_code}") from exc

    async def status(self) -> dict[str, Any]:
        try:
            response = await self._client.get("/internal/discord/status")
        except httpx.RequestError as exc:
            raise PlatformUnavailableError("無法連線至平台 API") from exc
        self._raise_for_status(response)
        return response.json()

    async def claim_event(self) -> dict[str, Any] | None:
        try:
            response = await self._client.get(
                "/internal/discord/events/claim",
                params={"wait_seconds": 20},
            )
        except httpx.RequestError as exc:
            raise PlatformUnavailableError("無法連線至平台 API") from exc
        if response.status_code == 204:
            return None
        self._raise_for_status(response)
        return response.json()

    async def acknowledge_event(
        self,
        event_id: uuid.UUID,
        *,
        success: bool,
        error: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        try:
            response = await self._client.post(
                f"/internal/discord/events/{event_id}/ack",
                json={
                    "success": success,
                    "error": error,
                    "result": result or {},
                },
            )
        except httpx.RequestError as exc:
            raise PlatformUnavailableError("無法連線至平台 API") from exc
        self._raise_for_status(response)

    async def member_joined(
        self,
        *,
        guild_id: int,
        discord_user_id: int,
        display_name: str,
    ) -> None:
        try:
            response = await self._client.post(
                "/internal/discord/members/joined",
                json={
                    "guild_id": str(guild_id),
                    "discord_user_id": str(discord_user_id),
                    "display_name": display_name,
                },
            )
        except httpx.RequestError as exc:
            raise PlatformUnavailableError("無法連線至平台 API") from exc
        self._raise_for_status(response)

    async def update_inventory(self, payload: dict[str, Any]) -> None:
        try:
            response = await self._client.put("/internal/discord/inventory", json=payload)
        except httpx.RequestError as exc:
            raise PlatformUnavailableError("無法連線至平台 API") from exc
        self._raise_for_status(response)

    async def command(
        self,
        operation: str,
        *,
        discord_user_id: int,
        interaction_id: int,
        guild_id: int | None,
        arguments: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            response = await self._client.post(
                f"/internal/discord/commands/{operation}",
                json={
                    "discord_user_id": str(discord_user_id),
                    "interaction_id": str(interaction_id),
                    "guild_id": str(guild_id) if guild_id else None,
                    "arguments": arguments or {},
                },
            )
        except httpx.RequestError as exc:
            raise PlatformUnavailableError("無法連線至平台 API") from exc
        if response.status_code == 409:
            raise PlatformCommandError(str(response.json().get("detail") or "平台操作失敗"))
        self._raise_for_status(response)
        return response.json()["data"]
