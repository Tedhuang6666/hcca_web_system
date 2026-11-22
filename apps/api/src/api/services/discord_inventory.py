"""Discord Bot inventory cache shared by the API and the gateway worker."""

from __future__ import annotations

import json
from typing import Any

from api.core.security import redis_client

_INVENTORY_KEY = "discord:bot:inventory"
_INVENTORY_TTL_SECONDS = 60


async def write_inventory(payload: dict[str, Any]) -> None:
    await redis_client.set(
        _INVENTORY_KEY,
        json.dumps(payload),
        ex=_INVENTORY_TTL_SECONDS,
    )


async def read_inventory() -> dict[str, Any] | None:
    raw = await redis_client.get(_INVENTORY_KEY)
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


async def inventory_guilds() -> list[dict[str, Any]]:
    inventory = await read_inventory()
    return list(inventory.get("guilds", [])) if inventory else []


async def inventory_guild(guild_id: str) -> dict[str, Any] | None:
    for guild in await inventory_guilds():
        if str(guild.get("id")) == guild_id:
            return guild
    return None
