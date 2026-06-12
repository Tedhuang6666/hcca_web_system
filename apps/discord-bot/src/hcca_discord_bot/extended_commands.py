"""Additional Discord features migrated from the legacy API-hosted cogs."""

from __future__ import annotations

import asyncio
import contextlib
import time
from datetime import datetime, timedelta
from typing import Any

import discord
from discord import app_commands
from discord.ext import commands

from hcca_discord_bot.api_client import PlatformCommandError
from hcca_discord_bot.commands import _command, _due_autocomplete, _parse_datetime
from hcca_discord_bot.config import settings

_POLL_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]


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


class MealItemSelect(discord.ui.Select):
    def __init__(self, schedule: dict[str, Any]) -> None:
        self.schedule = schedule
        options = [
            discord.SelectOption(
                label=item["name"][:100],
                value=item["id"],
                description=f"${item['price']}｜{item.get('description') or ''}"[:100],
            )
            for item in schedule["items"]
            if item["is_available"]
        ][:25]
        super().__init__(placeholder="選擇單品（一鍵下單）", options=options)

    async def callback(self, interaction: discord.Interaction) -> None:
        data = await _command(
            interaction,
            "meal_order",
            {
                "schedule_id": self.schedule["id"],
                "menu_item_id": self.values[0],
            },
        )
        if data is None:
            return
        view = discord.ui.View()
        view.add_item(discord.ui.Button(label="查看訂單", url=data["url"]))
        await interaction.response.edit_message(
            content=(
                f"已下單：{data['serial_number']}\n"
                f"取餐碼 `{data['pickup_code']}`｜${data['total_price']}"
            ),
            view=view,
            embed=None,
        )


class MealScheduleSelect(discord.ui.Select):
    def __init__(self, schedules: list[dict[str, Any]]) -> None:
        self.schedules = {row["id"]: row for row in schedules}
        super().__init__(
            placeholder="選擇要訂購的商家",
            options=[
                discord.SelectOption(
                    label=row["vendor_name"][:100],
                    value=row["id"],
                    description="已結單" if row["is_closed"] else "可訂購",
                )
                for row in schedules[:25]
            ],
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        schedule = self.schedules[self.values[0]]
        if schedule["is_closed"]:
            await interaction.response.send_message("這個排程已結單。", ephemeral=True)
            return
        available = [item for item in schedule["items"] if item["is_available"]]
        if not available:
            view = discord.ui.View()
            view.add_item(discord.ui.Button(label="在網頁完成", url=schedule["url"]))
            await interaction.response.edit_message(
                content=f"{schedule['vendor_name']} 採進階訂購，請在網頁完成。",
                view=view,
                embed=None,
            )
            return
        view = discord.ui.View(timeout=180)
        view.add_item(MealItemSelect(schedule))
        await interaction.response.edit_message(
            content=f"{schedule['vendor_name']}：選擇單品即可一鍵下單（數量 1）。",
            view=view,
            embed=None,
        )


class MealCancelSelect(discord.ui.Select):
    def __init__(self, orders: list[dict[str, Any]]) -> None:
        super().__init__(
            placeholder="選擇要取消的訂單",
            options=[
                discord.SelectOption(
                    label=row["serial_number"][:100],
                    value=row["id"],
                    description=f"取餐碼 {row['pickup_code']}｜${row['total_price']}",
                )
                for row in orders[:25]
            ],
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "meal_cancel", {"order_id": self.values[0]})
        if data is not None:
            await interaction.response.edit_message(
                content=f"已取消訂單 {data['serial_number']}",
                view=None,
            )


class AccountBrowseMealCog(commands.Cog):
    @app_commands.command(name="link", description="顯示綁定 / 重新綁定 Discord 帳號的連結")
    async def link(self, interaction: discord.Interaction) -> None:
        context = await _command(interaction, "context", silent=True)
        url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/profile?tab=integrations"
        title = "Discord 已綁定" if context else "尚未綁定 Discord"
        body = (
            f"平台名稱：{context['display_name']}\nEmail：{context['email']}"
            if context
            else "請到平台「個人資料 → 整合服務」完成綁定。"
        )
        view = discord.ui.View()
        view.add_item(discord.ui.Button(label="開啟整合設定", url=url))
        await interaction.response.send_message(
            embed=discord.Embed(title=title, description=body),
            view=view,
            ephemeral=True,
        )

    @app_commands.command(name="unlink", description="解除 Discord 與平台的綁定")
    async def unlink(self, interaction: discord.Interaction) -> None:
        if await _command(interaction, "unlink") is not None:
            await interaction.response.send_message(
                "已解除綁定；後續 DM 通知會停止。", ephemeral=True
            )

    @app_commands.command(name="announcements", description="近期公告（最多 10 則）")
    async def announcements(
        self, interaction: discord.Interaction, urgent_only: bool = False
    ) -> None:
        data = await _command(interaction, "browse_announcements", {"urgent_only": urgent_only})
        if data is None:
            return
        items = [
            {
                "name": f"{'緊急｜' if row['is_urgent'] else ''}{row['title']}",
                "value": f"{row['published_at'] or '—'}\n[打開]({row['url']})",
            }
            for row in data["items"]
        ]
        await interaction.response.send_message(
            embed=_embed("近期公告", items, "目前沒有公告。"), ephemeral=True
        )

    @app_commands.command(name="meetings_upcoming", description="兩週內會議")
    async def meetings_upcoming(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "browse_meetings")
        if data is not None:
            items = [
                {
                    "name": row["title"],
                    "value": (
                        f"{row['starts_at'] or '時間未定'}｜{row['location'] or '—'}\n"
                        f"[打開]({row['url']})"
                    ),
                }
                for row in data["items"]
            ]
            await interaction.response.send_message(
                embed=_embed("兩週內會議", items, "兩週內沒有會議。"), ephemeral=True
            )

    @app_commands.command(name="events_today", description="今日行事曆事件")
    async def events_today(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "browse_events")
        if data is not None:
            items = [
                {
                    "name": row["title"],
                    "value": (
                        f"{row['starts_at']}｜{row['location'] or '—'}\n[打開]({row['url']})"
                    ),
                }
                for row in data["items"]
            ]
            await interaction.response.send_message(
                embed=_embed("今日行事曆", items, "今天沒有行事曆事件。"),
                ephemeral=True,
            )

    @app_commands.command(name="surveys_open", description="目前開放的問卷")
    async def surveys_open(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "browse_surveys")
        if data is not None:
            items = [
                {
                    "name": row["title"],
                    "value": (
                        f"{'匿名' if row['is_anonymous'] else '具名'}｜"
                        f"截止 {row['closes_at'] or '無'}\n[填寫]({row['url']})"
                    ),
                }
                for row in data["items"]
            ]
            await interaction.response.send_message(
                embed=_embed("開放問卷", items, "目前沒有開放中的問卷。"),
                ephemeral=True,
            )

    @app_commands.command(name="regulations_recent", description="近期法規異動")
    async def regulations_recent(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "browse_regulations")
        if data is not None:
            items = [
                {
                    "name": f"{row['title']} v{row['version']}",
                    "value": f"流程：{row['workflow_status']}\n[打開]({row['url']})",
                }
                for row in data["items"]
            ]
            await interaction.response.send_message(
                embed=_embed("近期法規", items, "目前沒有法規資料。"), ephemeral=True
            )

    @app_commands.command(name="meal_today", description="今天的學餐供應，可直接互動下單")
    async def meal_today(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "meal_today")
        if data is None:
            return
        schedules = data["schedules"]
        if not schedules:
            await interaction.response.send_message("今天沒有學餐排程。", ephemeral=True)
            return
        embed = discord.Embed(title=f"今日學餐（{data['date']}）")
        for row in schedules:
            menu = "、".join(
                f"{item['name']}(${item['price']})"
                for item in row["items"][:5]
                if item["is_available"]
            )
            embed.add_field(
                name=row["vendor_name"],
                value=("已結單" if row["is_closed"] else menu or "進階訂購"),
                inline=False,
            )
        view = discord.ui.View(timeout=180)
        view.add_item(MealScheduleSelect(schedules))
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @app_commands.command(name="meal_week", description="未來七天的學餐菜單總覽")
    async def meal_week(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "meal_week")
        if data is not None:
            by_date: dict[str, list[str]] = {}
            for row in data["items"]:
                by_date.setdefault(row["date"], []).append(row["vendor_name"])
            items = [
                {"name": date, "value": "、".join(vendors)} for date, vendors in by_date.items()
            ]
            await interaction.response.send_message(
                embed=_embed("未來七天學餐", items, "未來七天沒有學餐排程。"),
                ephemeral=True,
            )

    @app_commands.command(name="meal_orders", description="我的近期學餐訂單與取餐碼")
    async def meal_orders(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "meal_orders")
        if data is not None:
            items = [
                {
                    "name": f"{row['status']}｜{row['serial_number']}",
                    "value": f"取餐碼 `{row['pickup_code']}`｜${row['total_price']}",
                }
                for row in data["items"]
            ]
            await interaction.response.send_message(
                embed=_embed("我的學餐訂單", items, "你還沒有學餐訂單。"),
                ephemeral=True,
            )

    @app_commands.command(name="meal_cancel", description="取消未結單的學餐訂單")
    async def meal_cancel(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "meal_cancel_choices")
        if data is None:
            return
        if not data["items"]:
            await interaction.response.send_message("沒有可取消的訂單。", ephemeral=True)
            return
        view = discord.ui.View(timeout=120)
        view.add_item(MealCancelSelect(data["items"]))
        await interaction.response.send_message("選擇要取消的訂單：", view=view, ephemeral=True)


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
        except PlatformCommandError:
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


async def load_extended_commands(bot: commands.Bot) -> None:
    await bot.add_cog(AccountBrowseMealCog())
    await bot.add_cog(ToolsCog(bot))
    await bot.add_cog(RegulationListenerCog(bot))
