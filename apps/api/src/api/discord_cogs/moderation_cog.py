"""社群伺服器管理 cog：/purge /timeout /untimeout /kick /ban /unban /slowmode /lock /unlock。"""

from __future__ import annotations

from datetime import timedelta

import discord
from discord import app_commands
from discord.ext import commands

from api.discord_cogs._helpers import audit_discord_action, require_platform_admin


class ModerationCog(commands.Cog):
    """伺服器管理指令；皆需平台 admin:all 權限。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="purge", description="清除本頻道最近訊息")
    async def purge(
        self, interaction: discord.Interaction, amount: app_commands.Range[int, 1, 100]
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        if not isinstance(interaction.channel, discord.TextChannel | discord.Thread):
            await interaction.response.send_message("此指令只能在文字頻道使用。", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        deleted = await interaction.channel.purge(limit=int(amount))
        await audit_discord_action(
            user,
            interaction,
            action="discord.community.purge",
            summary=f"Discord 清除 {len(deleted)} 則訊息",
            meta={"channel_id": str(interaction.channel_id), "amount": amount},
        )
        await interaction.followup.send(f"已清除 {len(deleted)} 則訊息。", ephemeral=True)

    @app_commands.command(name="timeout", description="將成員暫時禁言")
    async def timeout(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        minutes: app_commands.Range[int, 1, 10080],
        reason: str = "Discord 管理指令",
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        await member.timeout(
            discord.utils.utcnow() + timedelta(minutes=int(minutes)), reason=reason
        )
        await audit_discord_action(
            user,
            interaction,
            action="discord.community.timeout",
            summary=f"Discord 禁言 {member}",
            meta={"target_id": str(member.id), "minutes": minutes, "reason": reason},
        )
        await interaction.response.send_message(
            f"已禁言 {member.mention} {minutes} 分鐘。", ephemeral=True
        )

    @app_commands.command(name="untimeout", description="解除成員禁言")
    async def untimeout(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        reason: str = "Discord 管理指令",
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        await member.timeout(None, reason=reason)
        await audit_discord_action(
            user,
            interaction,
            action="discord.community.untimeout",
            summary=f"Discord 解除禁言 {member}",
            meta={"target_id": str(member.id), "reason": reason},
        )
        await interaction.response.send_message(
            f"已解除 {member.mention} 的禁言。", ephemeral=True
        )

    @app_commands.command(name="kick", description="踢出成員")
    async def kick(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        reason: str = "Discord 管理指令",
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        await member.kick(reason=reason)
        await audit_discord_action(
            user,
            interaction,
            action="discord.community.kick",
            summary=f"Discord 踢出 {member}",
            meta={"target_id": str(member.id), "reason": reason},
        )
        await interaction.response.send_message(f"已踢出 {member}。", ephemeral=True)

    @app_commands.command(name="ban", description="封鎖成員")
    async def ban(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        delete_message_days: app_commands.Range[int, 0, 7] = 0,
        reason: str = "Discord 管理指令",
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        await member.ban(delete_message_days=int(delete_message_days), reason=reason)
        await audit_discord_action(
            user,
            interaction,
            action="discord.community.ban",
            summary=f"Discord 封鎖 {member}",
            meta={
                "target_id": str(member.id),
                "delete_message_days": delete_message_days,
                "reason": reason,
            },
        )
        await interaction.response.send_message(f"已封鎖 {member}。", ephemeral=True)

    @app_commands.command(name="unban", description="用 Discord User ID 解除封鎖")
    async def unban(
        self,
        interaction: discord.Interaction,
        user_id: str,
        reason: str = "Discord 管理指令",
    ) -> None:
        actor = await require_platform_admin(interaction)
        if actor is None:
            return
        if interaction.guild is None:
            await interaction.response.send_message("此指令只能在伺服器內使用。", ephemeral=True)
            return
        target = discord.Object(id=int(user_id))
        await interaction.guild.unban(target, reason=reason)
        await audit_discord_action(
            actor,
            interaction,
            action="discord.community.unban",
            summary=f"Discord 解除封鎖 {user_id}",
            meta={"target_id": user_id, "reason": reason},
        )
        await interaction.response.send_message(f"已解除封鎖 {user_id}。", ephemeral=True)

    @app_commands.command(name="slowmode", description="設定本頻道慢速模式秒數")
    async def slowmode(
        self,
        interaction: discord.Interaction,
        seconds: app_commands.Range[int, 0, 21600],
        channel: discord.TextChannel | None = None,
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        target = channel or interaction.channel
        if not isinstance(target, discord.TextChannel):
            await interaction.response.send_message("請指定文字頻道。", ephemeral=True)
            return
        await target.edit(slowmode_delay=int(seconds), reason="HCCA Discord 管理指令")
        await audit_discord_action(
            user,
            interaction,
            action="discord.community.slowmode",
            summary=f"Discord 設定慢速模式 {seconds}s",
            meta={"channel_id": str(target.id), "seconds": seconds},
        )
        await interaction.response.send_message(
            f"已設定 {target.mention} 慢速模式 {seconds} 秒。", ephemeral=True
        )

    @app_commands.command(name="lock", description="鎖定本頻道，禁止 @everyone 發言")
    async def lock(
        self, interaction: discord.Interaction, channel: discord.TextChannel | None = None
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        target = channel or interaction.channel
        if not isinstance(target, discord.TextChannel) or interaction.guild is None:
            await interaction.response.send_message("請指定文字頻道。", ephemeral=True)
            return
        await target.set_permissions(
            interaction.guild.default_role,
            send_messages=False,
            reason="HCCA Discord 管理指令",
        )
        await audit_discord_action(
            user,
            interaction,
            action="discord.community.lock",
            summary=f"Discord 鎖定頻道 {target}",
            meta={"channel_id": str(target.id)},
        )
        await interaction.response.send_message(f"已鎖定 {target.mention}。", ephemeral=True)

    @app_commands.command(name="unlock", description="解除本頻道 @everyone 發言覆寫")
    async def unlock(
        self, interaction: discord.Interaction, channel: discord.TextChannel | None = None
    ) -> None:
        user = await require_platform_admin(interaction)
        if user is None:
            return
        target = channel or interaction.channel
        if not isinstance(target, discord.TextChannel) or interaction.guild is None:
            await interaction.response.send_message("請指定文字頻道。", ephemeral=True)
            return
        await target.set_permissions(
            interaction.guild.default_role,
            send_messages=None,
            reason="HCCA Discord 管理指令",
        )
        await audit_discord_action(
            user,
            interaction,
            action="discord.community.unlock",
            summary=f"Discord 解鎖頻道 {target}",
            meta={"channel_id": str(target.id)},
        )
        await interaction.response.send_message(
            f"已解除 {target.mention} 的發言鎖定。", ephemeral=True
        )
