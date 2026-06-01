"""帳號 cog：/link /unlink。

`/link` 給未綁定者一個 OAuth 連結（指向 web 端 /profile 的 Discord 綁定按鈕）；
已綁定者則顯示目前綁定狀態。`/unlink` 解除綁定。
"""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from api.core.config import settings
from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import (
    bound_user,
    reply_embed,
    reply_success,
    require_bound_user,
)
from api.services import audit as audit_svc
from api.services.discord_bot import unlink_user
from api.services.discord_embeds import Domain, Severity


def _frontend_url(path: str) -> str:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    return f"{base}{path if path.startswith('/') else '/' + path}"


class AccountCog(commands.Cog):
    """Discord ↔ 平台綁定管理。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="link", description="顯示綁定 / 重新綁定 Discord 帳號的連結")
    async def link(self, interaction: discord.Interaction) -> None:
        user = await bound_user(interaction)
        link_url = _frontend_url("/profile?tab=integrations")
        if user is None:
            await reply_embed(
                interaction,
                domain=Domain.SYSTEM,
                severity=Severity.WARNING,
                title="尚未綁定 Discord",
                body=(
                    "請到平台「個人資料 → 整合服務」按下「綁定 Discord」並選擇此帳號。\n"
                    "綁定後即可使用 /me、/dashboard、/petition 等需登入功能。"
                ),
                open_url=link_url,
            )
            return
        await reply_embed(
            interaction,
            domain=Domain.SYSTEM,
            severity=Severity.SUCCESS,
            title="Discord 已綁定",
            fields=[
                {"name": "平台名稱", "value": user.display_name, "inline": True},
                {"name": "Email", "value": user.email, "inline": True},
                {"name": "Discord", "value": f"<@{interaction.user.id}>", "inline": True},
            ],
            body="若要換綁，請按下方按鈕到平台先解除再重新綁定。",
            open_url=link_url,
        )

    @app_commands.command(name="unlink", description="解除 Discord 與平台的綁定")
    async def unlink(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            await unlink_user(db, user.id)
            await audit_svc.record(
                db,
                entity_type="discord_account_link",
                entity_id=str(user.id),
                action="discord.unlink",
                actor_id=str(user.id),
                actor_email=user.email,
                meta={
                    "discord_interaction_id": str(interaction.id),
                    "discord_user_id": str(interaction.user.id),
                },
                summary="使用者經 Discord 解除綁定",
            )
            await db.commit()
        await reply_success(
            interaction,
            domain=Domain.SYSTEM,
            title="已解除綁定",
            body="後續 DM 通知會停止；身分組同步也會在下一次 sync 時清除。\n要重新綁定請執行 `/link`。",
            open_url="/profile?tab=integrations",
        )
