"""Discord 平台 API 呼叫與 slash command 共用選項。"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

import discord
from discord import app_commands

from hcca_discord_bot.api_client import (
    PlatformApiClient,
    PlatformCommandError,
    PlatformUnavailableError,
)

_CATEGORY_LABEL = {
    "document_pending": "公文待核",
    "meal_closing": "學餐結單提醒",
    "survey_closing": "問卷截止提醒",
    "shop_ready": "福利社可取貨",
    "tenure": "任期變動",
    "regulation": "法規流程",
    "announcement_dm": "公告 DM",
    "petition_assigned": "陳情指派",
}

_QUIET_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

_TIMEOUT_PRESETS = [
    ("5 分鐘", 5),
    ("10 分鐘", 10),
    ("30 分鐘", 30),
    ("1 小時", 60),
    ("4 小時", 240),
    ("1 天", 1440),
    ("3 天", 4320),
    ("1 週", 10080),
]


def _client(interaction: discord.Interaction) -> PlatformApiClient:
    return interaction.client.platform  # type: ignore[attr-defined,no-any-return]


async def _command(
    interaction: discord.Interaction,
    operation: str,
    arguments: dict[str, Any] | None = None,
    *,
    silent: bool = False,
) -> dict[str, Any] | None:
    try:
        return await _client(interaction).command(
            operation,
            discord_user_id=interaction.user.id,
            interaction_id=interaction.id,
            guild_id=interaction.guild_id,
            arguments=arguments,
        )
    except PlatformCommandError as exc:
        if silent:
            return None
        sender = (
            interaction.followup.send
            if interaction.response.is_done()
            else interaction.response.send_message
        )
        await sender(str(exc), ephemeral=True)
        return None
    except PlatformUnavailableError:
        if silent:
            return None
        sender = (
            interaction.followup.send
            if interaction.response.is_done()
            else interaction.response.send_message
        )
        await sender("平台 API 暫時無法連線，請稍後再試。", ephemeral=True)
        return None


def _parse_datetime(value: str | None) -> str | None:
    if not value:
        return None
    presets = {
        "1h": datetime.now().astimezone() + timedelta(hours=1),
        "tomorrow": datetime.now().astimezone() + timedelta(days=1),
        "7d": datetime.now().astimezone() + timedelta(days=7),
    }
    if value in presets:
        return presets[value].isoformat()
    try:
        return datetime.fromisoformat(value).isoformat()
    except ValueError:
        return None


async def _due_autocomplete(
    _interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    choices = [
        app_commands.Choice(name="1 小時後", value="1h"),
        app_commands.Choice(name="明天同一時間", value="tomorrow"),
        app_commands.Choice(name="7 天後", value="7d"),
    ]
    return [choice for choice in choices if current.lower() in choice.name.lower()][:25]


async def _timeout_autocomplete(
    _interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[int]]:
    return [
        app_commands.Choice(name=label, value=minutes)
        for label, minutes in _TIMEOUT_PRESETS
        if current.lower() in label.lower()
    ][:25]


async def _work_item_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    data = await _command(interaction, "work_item_choices", silent=True)
    if data is None:
        return []
    return [
        app_commands.Choice(name=item["title"][:100], value=item["id"])
        for item in data["items"]
        if current.lower() in item["title"].lower()
    ][:25]


async def _petition_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    data = await _command(interaction, "petition_choices", silent=True)
    if data is None:
        return []
    return [
        app_commands.Choice(
            name=f"{item['case_number']}｜{item['title']}"[:100],
            value=item["id"],
        )
        for item in data["items"]
        if current.lower() in f"{item['case_number']} {item['title']}".lower()
    ][:25]


async def _moderation_audit(
    interaction: discord.Interaction,
    action: str,
    summary: str,
    meta: dict[str, Any],
) -> bool:
    return (
        await _command(
            interaction,
            "moderation_audit",
            {"action": action, "summary": summary, "meta": meta},
        )
        is not None
    )
