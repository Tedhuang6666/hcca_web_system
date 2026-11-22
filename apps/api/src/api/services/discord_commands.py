"""Discord command gateway; authorization and business handlers stay server-side."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.services.discord_command_common import DiscordCommandError, _actor
from api.services.discord_command_handlers import (
    admin,
    discovery,
    documents,
    handle_identity,
    notifications,
    operations,
    petitions,
    work_items,
)


async def execute(
    db: AsyncSession,
    *,
    operation: str,
    discord_user_id: str,
    interaction_id: str,
    guild_id: str | None,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    if operation in {"context", "user_lookup", "regulation_citations"}:
        result = await handle_identity(
            db, operation=operation, discord_user_id=discord_user_id, arguments=arguments
        )
        if result is not None:
            return result

    user, codes = await _actor(db, discord_user_id)
    for handler in (operations, work_items, documents, petitions, notifications, discovery, admin):
        result = await handler(
            db,
            user,
            codes,
            operation=operation,
            discord_user_id=discord_user_id,
            interaction_id=interaction_id,
            guild_id=guild_id,
            arguments=arguments,
        )
        if result is not None:
            return result
    raise DiscordCommandError(f"不支援的 Discord operation：{operation}")


__all__ = ["DiscordCommandError", "execute"]
