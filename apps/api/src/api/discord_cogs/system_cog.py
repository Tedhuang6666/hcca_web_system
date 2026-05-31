"""系統 / 公開資訊指令：/ping /hcca_help /system_status /defense_summary /server_info /user_info。"""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from api.core.database import AsyncSessionLocal, engine
from api.core.load_signals import snapshot as load_snapshot
from api.core.maintenance import get_load_shed_force_mode, get_maintenance_state
from api.core.metrics import get_celery_stats, get_db_pool_stats, get_redis_stats
from api.discord_cogs._helpers import (
    has_permission,
    require_bound_user,
)
from api.services import defense as defense_svc
from api.services.discord_bot import get_user_by_discord_id
from api.services.permission import get_user_permission_codes


class SystemCog(commands.Cog):
    """伺服器、平台狀態、説明指令。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="ping", description="確認 HCCA Bot 狀態")
    async def ping(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(
            f"HCCA Bot online. latency={self.bot.latency * 1000:.0f}ms",
            ephemeral=True,
        )

    @app_commands.command(name="hcca_help", description="查看 HCCA Bot 功能摘要")
    async def hcca_help(self, interaction: discord.Interaction) -> None:
        text = (
            "HCCA Bot\n"
            "個人：/me /tasks /sync_me\n"
            "工作：/assign_task /complete_task\n"
            "公文陳情：/documents_pending /petition /petitions_pending /petition_note /petition_channel\n"
            "系統：/system_status /defense_summary\n"
            "社群管理：admin:all 可用 /purge /timeout /untimeout /kick /ban /unban /slowmode /lock /unlock"
        )
        await interaction.response.send_message(text, ephemeral=True)

    @app_commands.command(name="system_status", description="查看系統狀態")
    async def system_status(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
        if not has_permission(user, codes, "admin:all"):
            await interaction.response.send_message("你沒有系統管理權限。", ephemeral=True)
            return
        db_pool = get_db_pool_stats(engine)
        redis = await get_redis_stats()
        celery = await get_celery_stats()
        maintenance = await get_maintenance_state()
        load = load_snapshot()
        text = (
            f"DB checked_out={db_pool.checked_out} utilization={db_pool.utilization:.0%}\n"
            f"Redis clients={redis.get('connected_clients')} error={redis.get('error')}\n"
            f"Celery error={celery.get('error')}\n"
            f"Maintenance={maintenance.get('enabled')} load_shed={await get_load_shed_force_mode()}\n"
            f"Active requests={load['active_requests']} 5xx={load['recent_5xx_count']}"
        )
        await interaction.response.send_message(text, ephemeral=True)

    @app_commands.command(name="defense_summary", description="查看防禦摘要")
    async def defense_summary(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not has_permission(user, codes, "admin:all"):
                await interaction.response.send_message("你沒有系統管理權限。", ephemeral=True)
                return
            data = await defense_svc.summary(db)
        await interaction.response.send_message(
            "防禦摘要\n"
            f"active_rules={data['active_rule_count']} total_rules={data['total_rule_count']}\n"
            f"status_counts={data['recent_status_counts']}",
            ephemeral=True,
        )

    @app_commands.command(name="server_info", description="查看伺服器摘要")
    async def server_info(self, interaction: discord.Interaction) -> None:
        if interaction.guild is None:
            await interaction.response.send_message("此指令只能在伺服器內使用。", ephemeral=True)
            return
        guild = interaction.guild
        text = (
            f"{guild.name}\n"
            f"members={guild.member_count} roles={len(guild.roles)} channels={len(guild.channels)}\n"
            f"owner_id={guild.owner_id} created_at={guild.created_at.date().isoformat()}"
        )
        await interaction.response.send_message(text, ephemeral=True)

    @app_commands.command(name="user_info", description="查看成員摘要")
    async def user_info(
        self, interaction: discord.Interaction, member: discord.Member | None = None
    ) -> None:
        target = member or interaction.user
        if not isinstance(target, discord.Member):
            await interaction.response.send_message("請在伺服器內使用。", ephemeral=True)
            return
        async with AsyncSessionLocal() as db:
            user = await get_user_by_discord_id(db, str(target.id))
        platform = f"平台：{user.display_name} / {user.email}" if user else "平台：未綁定"
        roles = ", ".join(role.name for role in target.roles[-5:] if role.name != "@everyone") or "無"
        text = (
            f"{target} ({target.id})\n"
            f"{platform}\n"
            f"joined_at={target.joined_at.date().isoformat() if target.joined_at else 'unknown'}\n"
            f"roles={roles}"
        )
        await interaction.response.send_message(text, ephemeral=True)
