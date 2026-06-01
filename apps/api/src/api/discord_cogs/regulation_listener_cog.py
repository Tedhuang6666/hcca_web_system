"""法條自動回覆 cog。

監聽頻道訊息，偵測「XX法第X條第X款」等引用，自動在該訊息下回覆條文摘要與跳轉連結。
需要 message_content 特權 intent（discord_worker 已啟用；Developer Portal 須勾選）。
"""

from __future__ import annotations

import logging
import time

import discord
from discord.ext import commands

from api.core.config import settings
from api.core.database import AsyncSessionLocal
from api.discord_cogs._regulation_parse import lookup_citation, parse_citations
from api.services.discord_embeds import Domain, Severity, build_embed

logger = logging.getLogger(__name__)

_CHANNEL_COOLDOWN_SECONDS = 4.0
_MAX_CITATIONS_PER_MESSAGE = 3


class RegulationListenerCog(commands.Cog):
    """訊息提到法條時自動回覆條文內容與連結。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self._last_reply_at: dict[int, float] = {}

    def _absolute_url(self, path: str) -> str:
        base = settings.FRONTEND_BASE_URL.rstrip("/")
        return f"{base}{path}"

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or message.guild is None:
            return
        if not message.content or "條" not in message.content:
            return
        citations = parse_citations(message.content, limit=_MAX_CITATIONS_PER_MESSAGE)
        if not citations:
            return
        # 每頻道節流，避免洗版
        now = time.monotonic()
        last = self._last_reply_at.get(message.channel.id, 0.0)
        if now - last < _CHANNEL_COOLDOWN_SECONDS:
            return

        embeds: list[discord.Embed] = []
        view = discord.ui.View()
        async with AsyncSessionLocal() as db:
            for citation in citations:
                found = await lookup_citation(db, citation)
                if found is None:
                    continue
                reg, article = found
                title = f"{reg.title}　第 {article.legal_number} 條"
                if article.subtitle:
                    title += f"（{article.subtitle}）"
                embeds.append(
                    discord.Embed.from_dict(
                        build_embed(
                            Domain.REGULATION,
                            Severity.INFO,
                            title=title[:250],
                            body=(article.content or "（本條無內容）")[:1500],
                        )
                    )
                )
                if len(view.children) < 5:
                    view.add_item(
                        discord.ui.Button(
                            style=discord.ButtonStyle.link,
                            label=f"看全文：{reg.title[:30]}",
                            url=self._absolute_url(f"/regulations/{reg.id}"),
                        )
                    )
        if not embeds:
            return
        self._last_reply_at[message.channel.id] = now
        try:
            await message.reply(
                embeds=embeds[:10],
                view=view if view.children else None,
                mention_author=False,
                silent=True,
            )
        except discord.HTTPException:
            logger.debug("法條自動回覆送出失敗", exc_info=True)
