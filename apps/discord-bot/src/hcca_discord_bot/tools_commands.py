"""Discord 平台工具 slash commands。"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import datetime, timedelta

import discord
from discord import app_commands
from discord.ext import commands

from hcca_discord_bot.command_common import _command, _due_autocomplete, _parse_datetime
from hcca_discord_bot.config import settings
from hcca_discord_bot.extended_common import _embed, _regulation_autocomplete, _survey_autocomplete

_POLL_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]


class ToolsCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="search", description="跨領域搜尋：公告 / 公文 / 法規")
    @app_commands.choices(
        scope=[
            app_commands.Choice(name="全部", value="all"),
            app_commands.Choice(name="公告", value="announcement"),
            app_commands.Choice(name="公文", value="document"),
            app_commands.Choice(name="法規", value="regulation"),
        ]
    )
    async def search(
        self,
        interaction: discord.Interaction,
        query: str,
        scope: app_commands.Choice[str] | None = None,
    ) -> None:
        data = await _command(
            interaction,
            "search",
            {"query": query, "scope": scope.value if scope else "all"},
        )
        if data is not None:
            items = [
                {
                    "name": f"{row['type']}｜{row['title']}",
                    "value": f"{row.get('subtitle') or ''}\n[打開]({row['url']})",
                }
                for row in data["items"]
            ]
            await interaction.response.send_message(
                embed=_embed(f"搜尋「{query}」", items, "找不到結果。"), ephemeral=True
            )

    @app_commands.command(name="quote", description="在頻道引用一條法規")
    @app_commands.autocomplete(regulation=_regulation_autocomplete)
    async def quote(
        self,
        interaction: discord.Interaction,
        regulation: str,
        article_no: str | None = None,
    ) -> None:
        data = await _command(
            interaction,
            "regulation_quote",
            {"regulation_id": regulation, "article_no": article_no},
        )
        if data is None:
            return
        title = f"{data['title']}：第 {data['legal_number']} 條"
        if data.get("subtitle"):
            title += f"（{data['subtitle']}）"
        view = discord.ui.View()
        view.add_item(discord.ui.Button(label="看全文", url=data["url"]))
        await interaction.response.send_message(
            content=f"<@{interaction.user.id}> 引用了一條法規",
            embed=discord.Embed(title=title, description=(data["content"] or "")[:4000]),
            view=view,
        )

    @app_commands.command(name="poll", description="發起 Discord 原生投票")
    async def poll(
        self,
        interaction: discord.Interaction,
        question: str,
        options: str = "要 | 不要",
        multiple: bool = False,
        hours: app_commands.Range[int, 1, 168] = 24,
    ) -> None:
        values = [value.strip() for value in options.split("|") if value.strip()]
        if not 2 <= len(values) <= 10:
            await interaction.response.send_message("選項需為 2 到 10 個。", ephemeral=True)
            return
        if hasattr(discord, "Poll"):
            poll = discord.Poll(
                question=question[:300],
                duration=timedelta(hours=hours),
                multiple=multiple,
            )
            for index, value in enumerate(values):
                poll.add_answer(text=value[:55], emoji=_POLL_EMOJIS[index])
            await interaction.response.send_message(poll=poll)
            return
        embed = discord.Embed(title=f"投票：{question}")
        for index, value in enumerate(values):
            embed.add_field(name=f"{_POLL_EMOJIS[index]} {value}", value="—", inline=False)
        await interaction.response.send_message(embed=embed)
        message = await interaction.original_response()
        for index in range(len(values)):
            with contextlib.suppress(discord.HTTPException):
                await message.add_reaction(_POLL_EMOJIS[index])

    @app_commands.command(name="survey_share", description="把開放中的平台問卷分享到此頻道")
    @app_commands.autocomplete(survey=_survey_autocomplete)
    async def survey_share(self, interaction: discord.Interaction, survey: str) -> None:
        data = await _command(interaction, "survey_choices")
        if data is None:
            return
        item = next((row for row in data["items"] if row["id"] == survey), None)
        if item is None:
            await interaction.response.send_message("找不到開放中的問卷。", ephemeral=True)
            return
        public_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/surveys/{survey}"
        view = discord.ui.View()
        view.add_item(discord.ui.Button(label="前往填寫", url=public_url))
        await interaction.response.send_message(
            embed=discord.Embed(
                title=f"問卷：{item['title']}",
                description=(
                    f"{'匿名' if item['is_anonymous'] else '具名'}｜"
                    f"截止 {item['closes_at'] or '無'}"
                ),
            ),
            view=view,
        )

    @app_commands.command(name="remind", description="個人提醒（DM 你一次）")
    @app_commands.autocomplete(when=_due_autocomplete)
    async def remind(self, interaction: discord.Interaction, text: str, when: str) -> None:
        if await _command(interaction, "context") is None:
            return
        target_raw = _parse_datetime(when)
        if target_raw is None:
            await interaction.response.send_message("時間格式不接受。", ephemeral=True)
            return
        target = datetime.fromisoformat(target_raw)
        delay = (target - datetime.now().astimezone()).total_seconds()
        if not 30 <= delay <= 30 * 24 * 3600:
            await interaction.response.send_message("提醒需介於 30 秒到 30 天。", ephemeral=True)
            return

        async def later() -> None:
            await asyncio.sleep(delay)
            await interaction.user.send(f"你的提醒到了：{text}")

        asyncio.create_task(later())
        await interaction.response.send_message(
            f"已排定提醒：{target.isoformat()}\n{text[:300]}", ephemeral=True
        )

    @app_commands.command(name="shortlink", description="產生 5 分鐘短效登入連結")
    async def shortlink(self, interaction: discord.Interaction, path: str) -> None:
        data = await _command(interaction, "shortlink", {"path": path})
        if data is not None:
            await interaction.response.send_message(data["url"], ephemeral=True)
