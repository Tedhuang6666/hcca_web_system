"""Extended Discord commands 共用 embed 與選單查詢。"""

from __future__ import annotations

from typing import Any

import discord
from discord import app_commands

from hcca_discord_bot.command_common import _command


def _embed(title: str, items: list[dict[str, Any]], empty: str) -> discord.Embed:
    embed = discord.Embed(title=title, color=discord.Color.blurple())
    if not items:
        embed.description = empty
        return embed
    for item in items[:10]:
        embed.add_field(
            name=str(item.get("name") or item.get("title") or "—")[:256],
            value=str(item.get("value") or "—")[:1024],
            inline=False,
        )
    return embed


async def _regulation_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    data = await _command(
        interaction,
        "regulation_choices",
        {"query": current},
        silent=True,
    )
    if data is None:
        return []
    return [
        app_commands.Choice(name=item["title"][:100], value=item["id"]) for item in data["items"]
    ][:25]


async def _survey_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    data = await _command(interaction, "survey_choices", silent=True)
    if data is None:
        return []
    return [
        app_commands.Choice(name=item["title"][:100], value=item["id"])
        for item in data["items"]
        if current.lower() in item["title"].lower()
    ][:25]
