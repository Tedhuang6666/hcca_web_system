"""Discord 社群管理 slash commands。"""

from __future__ import annotations

from datetime import timedelta

import discord
from discord import app_commands
from discord.ext import commands

from hcca_discord_bot.command_common import _moderation_audit, _timeout_autocomplete


class ModerationCog(commands.Cog):
    @app_commands.command(name="purge", description="清除本頻道最近訊息")
    async def purge(
        self, interaction: discord.Interaction, amount: app_commands.Range[int, 1, 100]
    ) -> None:
        if not isinstance(interaction.channel, discord.TextChannel | discord.Thread):
            await interaction.response.send_message("此指令只能在文字頻道使用。", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        if not await _moderation_audit(
            interaction,
            "discord.community.purge",
            f"Discord 清除 {amount} 則訊息",
            {"channel_id": str(interaction.channel_id), "amount": amount},
        ):
            return
        deleted = await interaction.channel.purge(limit=int(amount))
        await interaction.followup.send(f"已清除 {len(deleted)} 則訊息。", ephemeral=True)

    @app_commands.command(name="timeout", description="將成員暫時禁言")
    @app_commands.autocomplete(minutes=_timeout_autocomplete)
    async def timeout(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        minutes: app_commands.Range[int, 1, 10080],
        reason: str = "Discord 管理指令",
    ) -> None:
        if not await _moderation_audit(
            interaction,
            "discord.community.timeout",
            f"Discord 禁言 {member}",
            {"target_id": str(member.id), "minutes": minutes, "reason": reason},
        ):
            return
        await member.timeout(discord.utils.utcnow() + timedelta(minutes=minutes), reason=reason)
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
        if not await _moderation_audit(
            interaction,
            "discord.community.untimeout",
            f"Discord 解除禁言 {member}",
            {"target_id": str(member.id), "reason": reason},
        ):
            return
        await member.timeout(None, reason=reason)
        await interaction.response.send_message(f"已解除 {member.mention} 的禁言。", ephemeral=True)

    @app_commands.command(name="kick", description="踢出成員")
    async def kick(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        reason: str = "Discord 管理指令",
    ) -> None:
        if await _moderation_audit(
            interaction,
            "discord.community.kick",
            f"Discord 踢出 {member}",
            {"target_id": str(member.id), "reason": reason},
        ):
            await member.kick(reason=reason)
            await interaction.response.send_message(f"已踢出 {member}。", ephemeral=True)

    @app_commands.command(name="ban", description="封鎖成員")
    async def ban(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        delete_message_days: app_commands.Range[int, 0, 7] = 0,
        reason: str = "Discord 管理指令",
    ) -> None:
        if await _moderation_audit(
            interaction,
            "discord.community.ban",
            f"Discord 封鎖 {member}",
            {
                "target_id": str(member.id),
                "delete_message_days": delete_message_days,
                "reason": reason,
            },
        ):
            await member.ban(delete_message_days=delete_message_days, reason=reason)
            await interaction.response.send_message(f"已封鎖 {member}。", ephemeral=True)

    @app_commands.command(name="unban", description="用 Discord User ID 解除封鎖")
    async def unban(
        self,
        interaction: discord.Interaction,
        user_id: str,
        reason: str = "Discord 管理指令",
    ) -> None:
        if interaction.guild is None:
            await interaction.response.send_message("請在伺服器內使用。", ephemeral=True)
            return
        if await _moderation_audit(
            interaction,
            "discord.community.unban",
            f"Discord 解除封鎖 {user_id}",
            {"target_id": user_id, "reason": reason},
        ):
            await interaction.guild.unban(discord.Object(id=int(user_id)), reason=reason)
            await interaction.response.send_message(f"已解除封鎖 {user_id}。", ephemeral=True)

    @app_commands.command(name="slowmode", description="設定本頻道慢速模式秒數")
    async def slowmode(
        self,
        interaction: discord.Interaction,
        seconds: app_commands.Range[int, 0, 21600],
        channel: discord.TextChannel | None = None,
    ) -> None:
        target = channel or interaction.channel
        if not isinstance(target, discord.TextChannel):
            await interaction.response.send_message("請指定文字頻道。", ephemeral=True)
            return
        if await _moderation_audit(
            interaction,
            "discord.community.slowmode",
            f"Discord 設定慢速模式 {seconds}s",
            {"channel_id": str(target.id), "seconds": seconds},
        ):
            await target.edit(slowmode_delay=seconds, reason="HCCA Discord 管理指令")
            await interaction.response.send_message(
                f"已設定 {target.mention} 慢速模式 {seconds} 秒。", ephemeral=True
            )

    async def _lock(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel | None,
        locked: bool,
    ) -> None:
        target = channel or interaction.channel
        if not isinstance(target, discord.TextChannel) or interaction.guild is None:
            await interaction.response.send_message("請指定文字頻道。", ephemeral=True)
            return
        action = "lock" if locked else "unlock"
        if await _moderation_audit(
            interaction,
            f"discord.community.{action}",
            f"Discord {'鎖定' if locked else '解鎖'}頻道 {target}",
            {"channel_id": str(target.id)},
        ):
            await target.set_permissions(
                interaction.guild.default_role,
                send_messages=False if locked else None,
                reason="HCCA Discord 管理指令",
            )
            await interaction.response.send_message(
                f"已{'鎖定' if locked else '解鎖'} {target.mention}。", ephemeral=True
            )

    @app_commands.command(name="lock", description="鎖定本頻道")
    async def lock(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel | None = None,
    ) -> None:
        await self._lock(interaction, channel, True)

    @app_commands.command(name="unlock", description="解除本頻道發言鎖定")
    async def unlock(
        self,
        interaction: discord.Interaction,
        channel: discord.TextChannel | None = None,
    ) -> None:
        await self._lock(interaction, channel, False)
