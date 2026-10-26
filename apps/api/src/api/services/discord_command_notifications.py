"""Discord 指令領域 handler。"""

from __future__ import annotations

from datetime import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.discord_account import DEFAULT_DM_CATEGORIES
from api.models.user import User
from api.services.discord_command_common import (
    _preference,
    _preference_data,
)


async def handle(
    db: AsyncSession,
    user: User,
    codes: frozenset[str],
    *,
    operation: str,
    discord_user_id: str,
    interaction_id: str,
    guild_id: str | None,
    arguments: dict[str, Any],
) -> dict[str, Any] | None:
    if operation.startswith("notify_"):
        pref = await _preference(db, user.id)
        if operation == "notify_update":
            if "preferences" in arguments:
                pref.preferences = {
                    key: bool(value) for key, value in dict(arguments["preferences"]).items()
                }
            if "digest_daily_enabled" in arguments:
                pref.digest_daily_enabled = bool(arguments["digest_daily_enabled"])
            if "digest_weekly_enabled" in arguments:
                pref.digest_weekly_enabled = bool(arguments["digest_weekly_enabled"])
        elif operation == "notify_reset":
            pref.preferences = dict(DEFAULT_DM_CATEGORIES)
            pref.digest_daily_enabled = True
            pref.digest_weekly_enabled = False
            pref.quiet_hours_start = None
            pref.quiet_hours_end = None
            pref.timezone = "Asia/Taipei"
        elif operation == "notify_quiet":
            start = arguments.get("start")
            end = arguments.get("end")
            pref.quiet_hours_start = time.fromisoformat(start) if start else None
            pref.quiet_hours_end = time.fromisoformat(end) if end else None
        return _preference_data(pref)
    return None
