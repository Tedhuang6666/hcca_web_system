"""社群伺服器運營 cog：/server_health /welcome_preview /announce_pin。

提供 admin:all 使用的伺服器層級工具，與業務指令分離。
"""

from __future__ import annotations

import logging

import discord
from discord import app_commands
from discord.ext import commands

from api.core.database import AsyncSessionLocal, engine
from api.core.load_signals import snapshot as load_snapshot
from api.core.maintenance import get_load_shed_force_mode, get_maintenance_state
from api.core.metrics import get_celery_stats, get_db_pool_stats, get_redis_stats
from api.discord_cogs._helpers import require_platform_admin
from api.services import defense as defense_svc
from api.services.discord_bot import bot_health_snapshot
from api.services.discord_embeds import Domain, Severity, build_embed

logger = logging.getLogger(__name__)


class CommunityCog(commands.Cog):
    """伺服器層級工具：健康摘要、歡迎訊息預覽、公告 pin 管理。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="server_health", description="一張 embed 總覽平台與 bot 健康狀態")
    async def server_health(self, interaction: discord.Interaction) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        db_pool = get_db_pool_stats(engine)
        redis = await get_redis_stats()
        celery = await get_celery_stats()
        maintenance = await get_maintenance_state()
        load = load_snapshot()
        async with AsyncSessionLocal() as db:
            defense = await defense_svc.summary(db)
            bot_snap = await bot_health_snapshot(db)
        guild = interaction.guild
        guild_fields = []
        if guild is not None:
            guild_fields = [
                {"name": "成員數", "value": str(guild.member_count), "inline": True},
                {"name": "頻道", "value": str(len(guild.channels)), "inline": True},
                {"name": "身分組", "value": str(len(guild.roles)), "inline": True},
            ]
        fields = guild_fields + [
            {
                "name": "Bot 延遲",
                "value": f"{self.bot.latency * 1000:.0f} ms",
                "inline": True,
            },
            {
                "name": "已綁定 link",
                "value": "✅" if bot_snap.get("has_active_links") else "—",
                "inline": True,
            },
            {
                "name": "DB pool",
                "value": f"{db_pool.checked_out} / {db_pool.utilization:.0%}",
                "inline": True,
            },
            {
                "name": "Redis",
                "value": str(redis.get("connected_clients") or redis.get("error") or "—"),
                "inline": True,
            },
            {
                "name": "Celery",
                "value": str(celery.get("error") or "OK"),
                "inline": True,
            },
            {
                "name": "Maintenance",
                "value": str(maintenance.get("enabled")),
                "inline": True,
            },
            {
                "name": "Load shed",
                "value": str(await get_load_shed_force_mode()),
                "inline": True,
            },
            {
                "name": "Active req / 5xx",
                "value": f"{load['active_requests']} / {load['recent_5xx_count']}",
                "inline": True,
            },
            {
                "name": "Defense rules",
                "value": f"{defense['active_rule_count']} / {defense['total_rule_count']}",
                "inline": True,
            },
        ]
        embed = build_embed(
            Domain.SYSTEM,
            Severity.INFO,
            title="HCCA 平台與 Bot 健康總覽",
            fields=fields,
        )
        await interaction.followup.send(embed=discord.Embed.from_dict(embed), ephemeral=True)

    @app_commands.command(name="welcome_preview", description="預覽當前歡迎訊息 embed")
    async def welcome_preview(self, interaction: discord.Interaction) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        member_name = interaction.user.display_name
        embed = build_embed(
            Domain.SYSTEM,
            Severity.SUCCESS,
            title=f"歡迎 {member_name}",
            body=(
                f"<@{interaction.user.id}> 已加入伺服器。\n"
                "若已綁定平台帳號，身分組與暱稱會自動同步；尚未綁定者請至個人資料頁設定 Discord。"
            ),
        )
        await interaction.response.send_message(
            embed=discord.Embed.from_dict(embed),
            ephemeral=True,
        )

    @app_commands.command(name="announce_pin", description="把訊息 pin 到本頻道（admin 自用）")
    async def announce_pin(
        self,
        interaction: discord.Interaction,
        message_id: str,
        reason: str = "HCCA Discord 公告 pin",
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        if not isinstance(interaction.channel, discord.TextChannel | discord.Thread):
            await interaction.response.send_message("此指令只能在文字頻道使用。", ephemeral=True)
            return
        try:
            message = await interaction.channel.fetch_message(int(message_id))
        except (ValueError, discord.NotFound, discord.Forbidden) as exc:
            await interaction.response.send_message(f"找不到訊息：{exc}", ephemeral=True)
            return
        await message.pin(reason=reason)
        await interaction.response.send_message(f"已 pin 訊息 {message_id}。", ephemeral=True)
