"""學餐瀏覽與帳號連結 slash commands。"""

from __future__ import annotations

from typing import Any

import discord
from discord import app_commands
from discord.ext import commands

from hcca_discord_bot.command_common import _command
from hcca_discord_bot.config import settings
from hcca_discord_bot.extended_common import _embed


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
