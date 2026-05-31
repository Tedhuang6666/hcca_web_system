"""HCCA Discord Bot 主進程。

採 Cog 結構，所有指令定義在 api.discord_cogs.* 之下；本檔只負責：
1. Bot 啟動與身分組同步
2. 載入所有 cogs
3. 全域事件監聽（如 on_member_join）
"""

from __future__ import annotations

import asyncio
import logging

# discord.py 在 import 當下就會用 `discord.client` logger 印 PyNaCl / davey 缺失警告，
# 而我們是純文字 bot 用不到語音。等級要在 `import discord` 之前提高才能攔到。
logging.getLogger("discord.client").setLevel(logging.ERROR)

import discord  # noqa: E402
from discord.ext import commands  # noqa: E402

from api.core.config import settings  # noqa: E402
from api.core.database import AsyncSessionLocal  # noqa: E402
from api.discord_cogs import load_all as load_all_cogs  # noqa: E402
from api.services.discord_bot import (  # noqa: E402
    emit_moderation_log,
    emit_welcome_message,
    enqueue_role_sync,
    get_user_by_discord_id,
)

logger = logging.getLogger(__name__)


class HccaDiscordBot(commands.Bot):
    """HCCA 平台的 Discord 第二工作台。"""

    def __init__(self) -> None:
        intents = discord.Intents.default()
        intents.members = True
        intents.moderation = True
        super().__init__(
            command_prefix=commands.when_mentioned,
            intents=intents,
            help_command=None,
        )

    async def setup_hook(self) -> None:
        await load_all_cogs(self)
        guild_id = settings.DISCORD_COMMAND_SYNC_GUILD_ID or settings.DISCORD_GUILD_ID
        if guild_id:
            guild = discord.Object(id=int(guild_id))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()
        logger.info("Discord bot cogs 載入完成 cogs=%d", len(self.cogs))

    async def on_member_join(self, member: discord.Member) -> None:
        async with AsyncSessionLocal() as db:
            user = await get_user_by_discord_id(db, str(member.id))
            if user is not None:
                await enqueue_role_sync(db, user.id)
                await emit_moderation_log(
                    db,
                    guild_id=str(member.guild.id),
                    title="Discord 成員加入並已綁定平台",
                    body=f"{member} / {user.display_name}",
                )
            await emit_welcome_message(
                db,
                guild_id=str(member.guild.id),
                discord_user_id=str(member.id),
                display_name=member.display_name,
            )
            await db.commit()


bot = HccaDiscordBot()


async def main() -> None:
    if not settings.DISCORD_BOT_TOKEN:
        raise RuntimeError("DISCORD_BOT_TOKEN 未設定")
    await bot.start(settings.DISCORD_BOT_TOKEN)


if __name__ == "__main__":
    from api.core.structured_logging import configure_logging

    configure_logging()
    asyncio.run(main())
