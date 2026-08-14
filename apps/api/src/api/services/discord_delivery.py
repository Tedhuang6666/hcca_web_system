"""低階 Discord outbox delivery primitives."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.services.outbox import emit


async def emit_user_dm(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    embed: dict[str, Any],
    components: list[dict[str, Any]] | None = None,
    category: str | None = None,
) -> None:
    """個人 DM 推播。dispatcher 端會檢查 NotificationPreference 與綁定狀態。"""
    await emit(
        db,
        event_type="discord.user_dm",
        payload={
            "user_id": str(user_id),
            "embed": embed,
            "components": components,
            "category": category,
        },
    )
