"""Autocomplete helpers — 共用給 cogs 使用。

只把展示與字串解析放在這裡；資料查詢一律走既有 service，不重做對象選擇邏輯。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import discord
from discord import app_commands
from sqlalchemy import select

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import bound_user
from api.models.petition import PetitionCase
from api.models.work_item import WorkItem


DUE_AT_PRESETS: list[tuple[str, int]] = [
    ("今天 18:00", 0),
    ("明天 18:00", 1),
    ("後天 18:00", 2),
    ("+3 天", 3),
    ("+7 天", 7),
    ("+14 天", 14),
]


def parse_due_at(value: str | None) -> datetime | None:
    """Accept ISO 8601 或 autocomplete 預設標籤；解析失敗回 None。"""
    if not value:
        return None
    stripped = value.strip()
    # 直接日期模式
    try:
        parsed = datetime.fromisoformat(stripped.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed
    except ValueError:
        pass
    for label, delta_days in DUE_AT_PRESETS:
        if stripped == label:
            base = datetime.now(UTC) + timedelta(days=delta_days)
            return base.replace(hour=10, minute=0, second=0, microsecond=0)  # UTC 10:00 = 台北 18:00
    return None


async def due_at_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    current_lower = (current or "").lower()
    return [
        app_commands.Choice(name=label, value=label)
        for label, _ in DUE_AT_PRESETS
        if current_lower in label.lower()
    ][:25]


async def assigned_petition_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    user = await bound_user(interaction)
    if user is None:
        return []
    needle = (current or "").lower()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PetitionCase)
            .where(PetitionCase.assigned_to_id == user.id)
            .order_by(PetitionCase.created_at.desc())
            .limit(25)
        )
        rows = list(result.scalars().all())
    choices: list[app_commands.Choice[str]] = []
    for case in rows:
        label = f"{case.case_number}｜{case.title[:60]}"
        if needle and needle not in label.lower():
            continue
        choices.append(app_commands.Choice(name=label[:100], value=str(case.id)))
    return choices[:25]


async def my_work_item_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    user = await bound_user(interaction)
    if user is None:
        return []
    needle = (current or "").lower()
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(WorkItem)
            .where(WorkItem.assigned_to_id == user.id)
            .where(WorkItem.completed_at.is_(None))
            .order_by(WorkItem.created_at.desc())
            .limit(25)
        )
        rows = list(result.scalars().all())
    choices: list[app_commands.Choice[str]] = []
    for item in rows:
        label = item.title[:80]
        if needle and needle not in label.lower():
            continue
        choices.append(app_commands.Choice(name=label[:100], value=str(item.id)))
    return choices[:25]


__all__ = [
    "DUE_AT_PRESETS",
    "assigned_petition_autocomplete",
    "due_at_autocomplete",
    "my_work_item_autocomplete",
    "parse_due_at",
]
