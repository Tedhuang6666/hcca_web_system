"""公文 cog：/documents_pending（核稿用）。"""

from __future__ import annotations

import uuid

import discord
from discord import app_commands
from discord.ext import commands

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import require_bound_user
from api.discord_cogs._views import DocumentActionView
from api.services.discord_bot import create_open_url
from api.services.task_inbox import build_task_inbox


class DocumentsCog(commands.Cog):
    """公文核稿 / 退件相關指令。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="documents_pending", description="列出待你審核的公文")
    async def documents_pending(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        async with AsyncSessionLocal() as db:
            inbox = await build_task_inbox(db, user)
            docs = [item for item in inbox.items if item.module == "document"][:5]
            if not docs:
                await interaction.followup.send("目前沒有待審公文。", ephemeral=True)
                return
            for item in docs:
                try:
                    document_id = uuid.UUID(item.id.split(":")[1])
                except (IndexError, ValueError):
                    continue
                await interaction.followup.send(
                    f"{item.title}\n{item.subtitle or ''}",
                    view=DocumentActionView(document_id, await create_open_url(user.id, item.href)),
                    ephemeral=True,
                )
