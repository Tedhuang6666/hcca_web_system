"""帳號連結與平台資訊瀏覽 slash commands。"""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from hcca_discord_bot.command_common import _command
from hcca_discord_bot.config import settings
from hcca_discord_bot.extended_common import _embed


class AccountBrowseCog(commands.Cog):
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
