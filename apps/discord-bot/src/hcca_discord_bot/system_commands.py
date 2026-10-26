"""系統狀態與伺服器資訊 slash commands。"""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from hcca_discord_bot.command_common import _command, _moderation_audit


class SystemCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="system_status", description="查看系統狀態")
    async def system_status(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "system_status")
        if data is not None:
            await interaction.response.send_message(
                f"DB checked_out={data['db_checked_out']} "
                f"utilization={data['db_utilization']:.0%}\n"
                f"Redis={data['redis'].get('connected_clients') or data['redis'].get('error')}\n"
                f"Celery={data['celery'].get('error') or 'OK'}\n"
                f"Maintenance={data['maintenance'].get('enabled')} "
                f"load_shed={data['load_shed']}\n"
                f"Active requests={data['load']['active_requests']} "
                f"5xx={data['load']['recent_5xx_count']}",
                ephemeral=True,
            )

    @app_commands.command(name="defense_summary", description="查看防禦摘要")
    async def defense_summary(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "defense_summary")
        if data is not None:
            await interaction.response.send_message(
                "防禦摘要\n"
                f"active_rules={data['active_rule_count']} "
                f"total_rules={data['total_rule_count']}\n"
                f"status_counts={data['recent_status_counts']}",
                ephemeral=True,
            )

    @app_commands.command(name="server_info", description="查看伺服器摘要")
    async def server_info(self, interaction: discord.Interaction) -> None:
        guild = interaction.guild
        if guild is None:
            await interaction.response.send_message("請在伺服器內使用。", ephemeral=True)
            return
        await interaction.response.send_message(
            f"{guild.name}\nmembers={guild.member_count} roles={len(guild.roles)} "
            f"channels={len(guild.channels)}\nowner_id={guild.owner_id} "
            f"created_at={guild.created_at.date().isoformat()}",
            ephemeral=True,
        )

    @app_commands.command(name="user_info", description="查看成員摘要")
    async def user_info(
        self, interaction: discord.Interaction, member: discord.Member | None = None
    ) -> None:
        target = member or interaction.user
        if not isinstance(target, discord.Member):
            await interaction.response.send_message("請在伺服器內使用。", ephemeral=True)
            return
        data = await _command(interaction, "user_lookup", {"discord_user_id": str(target.id)})
        if data is None:
            return
        platform = (
            f"平台：{data['display_name']} / {data['email']}" if data["linked"] else "平台：未綁定"
        )
        roles = ", ".join(role.name for role in target.roles[-5:] if role.name != "@everyone")
        await interaction.response.send_message(
            f"{target} ({target.id})\n{platform}\n"
            f"joined_at={target.joined_at.date().isoformat() if target.joined_at else 'unknown'}\n"
            f"roles={roles or '無'}",
            ephemeral=True,
        )

    @app_commands.command(name="server_health", description="總覽平台與 Bot 健康狀態")
    async def server_health(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "server_health")
        if data is None:
            return
        system = data["system"]
        embed = discord.Embed(title="HCCA 平台與 Bot 健康總覽")
        embed.add_field(name="Bot 延遲", value=f"{self.bot.latency * 1000:.0f} ms", inline=True)
        embed.add_field(
            name="DB pool",
            value=f"{system['db_checked_out']} / {system['db_utilization']:.0%}",
            inline=True,
        )
        embed.add_field(
            name="Defense rules",
            value=f"{data['defense']['active_rule_count']} / {data['defense']['total_rule_count']}",
            inline=True,
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="welcome_preview", description="預覽歡迎訊息")
    async def welcome_preview(self, interaction: discord.Interaction) -> None:
        if await _command(interaction, "server_health") is None:
            return
        embed = discord.Embed(
            title=f"歡迎 {interaction.user.display_name}",
            description=(
                f"<@{interaction.user.id}> 已加入伺服器。\n"
                "若已綁定平台帳號，身分組與暱稱會自動同步；"
                "尚未綁定者請至個人資料頁設定 Discord。"
            ),
            color=discord.Color.green(),
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="announce_pin", description="把訊息 pin 到本頻道")
    async def announce_pin(
        self,
        interaction: discord.Interaction,
        message_id: str,
        reason: str = "HCCA Discord 公告 pin",
    ) -> None:
        if not isinstance(interaction.channel, discord.TextChannel | discord.Thread):
            await interaction.response.send_message("此指令只能在文字頻道使用。", ephemeral=True)
            return
        if not await _moderation_audit(
            interaction,
            "discord.community.announce_pin",
            f"Discord pin 訊息 {message_id}",
            {"channel_id": str(interaction.channel_id), "message_id": message_id},
        ):
            return
        message = await interaction.channel.fetch_message(int(message_id))
        await message.pin(reason=reason)
        await interaction.response.send_message(f"已 pin 訊息 {message_id}。", ephemeral=True)
