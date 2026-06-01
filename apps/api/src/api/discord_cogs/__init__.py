"""HCCA Discord bot cogs。

每個 cog 對應一個業務領域，由 discord_worker 的 setup_hook 載入。
新增功能請新增獨立 cog，不要再加回 discord_worker.py。
"""

from __future__ import annotations

from discord.ext import commands

from api.discord_cogs.admin_cog import AdminCog
from api.discord_cogs.community_cog import CommunityCog
from api.discord_cogs.dashboard_cog import DashboardCog
from api.discord_cogs.documents_cog import DocumentsCog
from api.discord_cogs.moderation_cog import ModerationCog
from api.discord_cogs.notify_cog import NotifyCog
from api.discord_cogs.personal_cog import PersonalCog
from api.discord_cogs.petitions_cog import PetitionsCog
from api.discord_cogs.quick_create_cog import QuickCreateCog
from api.discord_cogs.system_cog import SystemCog
from api.discord_cogs.work_cog import WorkCog


async def load_all(bot: commands.Bot) -> None:
    """把所有 cog 載入 bot。新增 cog 後在此追加一行。"""
    for cog_cls in (
        SystemCog,
        PersonalCog,
        DashboardCog,
        WorkCog,
        DocumentsCog,
        PetitionsCog,
        NotifyCog,
        QuickCreateCog,
        AdminCog,
        CommunityCog,
        ModerationCog,
    ):
        await bot.add_cog(cog_cls(bot))


__all__ = ["load_all"]
