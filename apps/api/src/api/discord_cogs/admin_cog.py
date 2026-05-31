"""平台 admin cog：/sync_all。"""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import require_platform_admin
from api.services import audit as audit_svc
from api.services.discord_bot import emit_moderation_log, enqueue_all_role_sync


class AdminCog(commands.Cog):
    """需要平台 admin:all 權限才能執行的批次/維運指令。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="sync_all", description="排程同步所有已綁定成員")
    async def sync_all(self, interaction: discord.Interaction) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            queued = await enqueue_all_role_sync(db)
            await audit_svc.record(
                db,
                entity_type="discord_account_link",
                entity_id="all",
                action="discord.sync_all",
                actor_id=str(user.id),
                actor_email=user.email,
                meta={"discord_interaction_id": str(interaction.id), "queued": queued},
                summary="Discord 排程同步所有已綁定成員",
            )
            await emit_moderation_log(
                db,
                guild_id=str(interaction.guild_id) if interaction.guild_id else None,
                title="Discord 排程同步所有已綁定成員",
                body=f"queued: {queued}",
            )
            await db.commit()
        await interaction.response.send_message(
            f"已排程同步 {queued} 位已綁定成員。", ephemeral=True
        )
