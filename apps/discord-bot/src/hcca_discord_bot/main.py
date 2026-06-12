"""Standalone Discord Bot process."""

from __future__ import annotations

import asyncio
import logging
import uuid

import discord
from discord.ext import commands

from hcca_discord_bot.api_client import PlatformApiClient, PlatformUnavailableError
from hcca_discord_bot.commands import load_commands
from hcca_discord_bot.config import settings
from hcca_discord_bot.delivery import dispatch
from hcca_discord_bot.extended_commands import load_extended_commands

logger = logging.getLogger(__name__)


class HccaDiscordBot(commands.Bot):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        super().__init__(
            command_prefix=commands.when_mentioned,
            intents=intents,
            help_command=None,
        )
        self.platform = PlatformApiClient(
            settings.HCCA_API_URL,
            settings.HCCA_API_KEY,
            cf_access_client_id=settings.HCCA_API_CF_ACCESS_CLIENT_ID,
            cf_access_client_secret=settings.HCCA_API_CF_ACCESS_CLIENT_SECRET,
        )
        self.delivery_task: asyncio.Task[None] | None = None
        self.inventory_task: asyncio.Task[None] | None = None

    async def setup_hook(self) -> None:
        await load_commands(self)
        await load_extended_commands(self)
        guild_id = settings.DISCORD_COMMAND_SYNC_GUILD_ID or settings.DISCORD_GUILD_ID
        if guild_id:
            guild = discord.Object(id=int(guild_id))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()
        self.delivery_task = asyncio.create_task(self.delivery_loop())
        self.inventory_task = asyncio.create_task(self.inventory_loop())

    async def close(self) -> None:
        tasks = [task for task in (self.delivery_task, self.inventory_task) if task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.platform.close()
        await super().close()

    async def on_member_join(self, member: discord.Member) -> None:
        try:
            await self.platform.member_joined(
                guild_id=member.guild.id,
                discord_user_id=member.id,
                display_name=member.display_name,
            )
        except PlatformUnavailableError:
            logger.exception("Failed to report Discord member join")

    async def on_member_update(
        self, before: discord.Member, after: discord.Member
    ) -> None:
        if before.roles == after.roles and before.display_name == after.display_name:
            return
        try:
            await self.platform.member_updated(
                guild_id=after.guild.id,
                discord_user_id=after.id,
                nickname=after.display_name,
                role_ids=[role.id for role in after.roles if not role.is_default()],
            )
        except PlatformUnavailableError:
            logger.exception("Failed to report Discord member update")

    async def on_ready(self) -> None:
        try:
            status = await self.platform.status()
            logger.info("Connected to platform API: %s", status["status"])
        except PlatformUnavailableError:
            logger.warning("Platform API is currently unavailable; retrying in background")
        await self.report_inventory()

    async def on_guild_join(self, _guild: discord.Guild) -> None:
        await self.report_inventory()

    async def on_guild_remove(self, _guild: discord.Guild) -> None:
        await self.report_inventory()

    async def on_guild_channel_create(self, _channel: discord.abc.GuildChannel) -> None:
        await self.report_inventory()

    async def on_guild_channel_delete(self, _channel: discord.abc.GuildChannel) -> None:
        await self.report_inventory()

    async def on_guild_role_create(self, _role: discord.Role) -> None:
        await self.report_inventory()

    async def on_guild_role_delete(self, _role: discord.Role) -> None:
        await self.report_inventory()

    async def on_guild_role_update(
        self, _before: discord.Role, _after: discord.Role
    ) -> None:
        await self.report_inventory()

    async def report_inventory(self) -> None:
        if self.user is None:
            return
        guilds = []
        for guild in self.guilds:
            guilds.append(
                {
                    "id": str(guild.id),
                    "name": guild.name,
                    "icon": str(guild.icon.key) if guild.icon else None,
                    "channels": [
                        {
                            "id": str(channel.id),
                            "name": channel.name,
                            "type": channel.type.value,
                            "parent_id": (
                                str(channel.category_id)
                                if hasattr(channel, "category_id") and channel.category_id
                                else None
                            ),
                        }
                        for channel in guild.channels
                    ],
                    "roles": [
                        {
                            "id": str(role.id),
                            "name": role.name,
                            "color": role.color.value,
                            "position": role.position,
                            "managed": role.managed,
                        }
                        for role in guild.roles
                    ],
                }
            )
        try:
            await self.platform.update_inventory(
                {
                    "bot_user_id": str(self.user.id),
                    "bot_username": str(self.user),
                    "latency_ms": max(0, self.latency * 1000),
                    "guilds": guilds,
                }
            )
        except PlatformUnavailableError:
            logger.warning("Failed to report Discord inventory; will retry")

    async def inventory_loop(self) -> None:
        await self.wait_until_ready()
        while not self.is_closed():
            await self.report_inventory()
            await asyncio.sleep(20)

    async def delivery_loop(self) -> None:
        await self.wait_until_ready()
        while not self.is_closed():
            event: dict | None = None
            try:
                event = await self.platform.claim_event()
                if event is None:
                    continue
                event_id = uuid.UUID(event["id"])
                result = await dispatch(self, event["event_type"], event["payload"])
                await self.platform.acknowledge_event(event_id, success=True, result=result)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("Discord event delivery failed")
                if event is not None:
                    try:
                        await self.platform.acknowledge_event(
                            uuid.UUID(event["id"]),
                            success=False,
                            error=str(exc),
                        )
                    except Exception:
                        logger.exception("Failed to acknowledge Discord event failure")
                await asyncio.sleep(2)


def run() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if not settings.DISCORD_BOT_TOKEN:
        raise RuntimeError("DISCORD_BOT_TOKEN 未設定")
    if not settings.HCCA_API_KEY:
        raise RuntimeError("HCCA_API_KEY 未設定")
    HccaDiscordBot().run(settings.DISCORD_BOT_TOKEN, log_handler=None)
