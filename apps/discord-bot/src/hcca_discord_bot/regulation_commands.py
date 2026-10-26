"""法規引用自動回覆 listener。"""

from __future__ import annotations

import time

import discord
from discord.ext import commands

from hcca_discord_bot.api_client import PlatformCommandError, PlatformUnavailableError
from hcca_discord_bot.config import settings


class RegulationListenerCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self._last_reply_at: dict[int, float] = {}

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or message.guild is None or "條" not in message.content:
            return
        now = time.monotonic()
        if now - self._last_reply_at.get(message.channel.id, 0) < 4:
            return
        try:
            data = await self.bot.platform.command(  # type: ignore[attr-defined]
                "regulation_citations",
                discord_user_id=message.author.id,
                interaction_id=message.id,
                guild_id=message.guild.id,
                arguments={"content": message.content},
            )
        except (PlatformCommandError, PlatformUnavailableError):
            return
        if not data["items"]:
            return
        embeds = []
        view = discord.ui.View()
        for item in data["items"]:
            title = f"{item['title']}　第 {item['legal_number']} 條"
            if item.get("subtitle"):
                title += f"（{item['subtitle']}）"
            embeds.append(
                discord.Embed(title=title[:256], description=(item["content"] or "")[:4000])
            )
            if len(view.children) < 5:
                view.add_item(
                    discord.ui.Button(
                        label=f"看全文：{item['title'][:30]}",
                        url=f"{settings.FRONTEND_BASE_URL.rstrip('/')}{item['url']}",
                    )
                )
        self._last_reply_at[message.channel.id] = now
        await message.reply(
            embeds=embeds,
            view=view if view.children else None,
            mention_author=False,
            silent=True,
        )
