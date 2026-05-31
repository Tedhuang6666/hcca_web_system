"""個人功能 cog：/me /tasks /sync_me。"""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import require_bound_user
from api.services.discord_bot import create_open_url, enqueue_role_sync
from api.services.task_inbox import build_task_inbox


class PersonalCog(commands.Cog):
    """綁定者個人待辦／同步指令。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="me", description="查看平台綁定與待辦摘要")
    async def me(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            inbox = await build_task_inbox(db, user)
            open_url = await create_open_url(user.id, "/dashboard")
        await interaction.response.send_message(
            f"{user.display_name}\n待辦：{inbox.total} 件\n{open_url}",
            ephemeral=True,
        )

    @app_commands.command(name="tasks", description="列出平台待辦")
    async def tasks(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            inbox = await build_task_inbox(db, user)
            if not inbox.items:
                await interaction.response.send_message("目前沒有待辦。", ephemeral=True)
                return
            lines = [f"待辦共 {inbox.total} 件："]
            for item in inbox.items[:8]:
                lines.append(f"- {item.title}：{await create_open_url(user.id, item.href)}")
        await interaction.response.send_message("\n".join(lines), ephemeral=True)

    @app_commands.command(name="sync_me", description="同步自己的平台身分組與社群暱稱前綴")
    async def sync_me(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            await enqueue_role_sync(db, user.id)
            await db.commit()
        await interaction.response.send_message("已排程同步你的身分組與暱稱前綴。", ephemeral=True)
