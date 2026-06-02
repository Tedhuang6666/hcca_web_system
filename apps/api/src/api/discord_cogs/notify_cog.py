"""通知偏好 cog：/notify /notify_status /notify_reset /notify_quiet。

允許使用者在 Discord 內自選想收哪些 DM、設定 quiet hours。
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime, time

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import require_bound_user
from api.models.discord_account import DEFAULT_DM_CATEGORIES, DiscordNotificationPreference
from api.services import audit as audit_svc
from api.services.discord_embeds import Domain, Severity, build_embed

logger = logging.getLogger(__name__)


_CATEGORY_LABEL: dict[str, str] = {
    "document_pending": "公文待核",
    "meeting_invited": "會議通知",
    "calendar_reminder": "行事曆提醒",
    "meal_closing": "學餐結單提醒",
    "survey_closing": "問卷截止提醒",
    "shop_ready": "福利社可取貨",
    "tenure": "任期變動",
    "regulation": "法規流程",
    "announcement_dm": "公告 DM",
    "petition_assigned": "陳情指派",
}

_QUIET_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


async def _get_or_create_preference(db, user_id: uuid.UUID) -> DiscordNotificationPreference:
    pref = await db.scalar(
        select(DiscordNotificationPreference).where(
            DiscordNotificationPreference.user_id == user_id
        )
    )
    if pref is None:
        pref = DiscordNotificationPreference(
            user_id=user_id,
            preferences=dict(DEFAULT_DM_CATEGORIES),
        )
        db.add(pref)
        await db.flush()
    return pref


def _prefs_embed(pref: DiscordNotificationPreference) -> dict:
    prefs = pref.preferences or {}
    fields = []
    for key, label in _CATEGORY_LABEL.items():
        enabled = prefs.get(key, DEFAULT_DM_CATEGORIES.get(key, True))
        fields.append(
            {
                "name": label,
                "value": "✅ 已訂閱" if enabled else "🔕 已關閉",
                "inline": True,
            }
        )
    fields.append(
        {
            "name": "每日摘要",
            "value": "✅" if pref.digest_daily_enabled else "🔕",
            "inline": True,
        }
    )
    fields.append(
        {
            "name": "每週摘要",
            "value": "✅" if pref.digest_weekly_enabled else "🔕",
            "inline": True,
        }
    )
    quiet = "未設定"
    if pref.quiet_hours_start and pref.quiet_hours_end:
        quiet = (
            f"{pref.quiet_hours_start.strftime('%H:%M')} – "
            f"{pref.quiet_hours_end.strftime('%H:%M')} ({pref.timezone})"
        )
    fields.append({"name": "免打擾", "value": quiet, "inline": True})
    return build_embed(
        Domain.SYSTEM,
        Severity.INFO,
        title="Discord 通知偏好",
        body="用 `/notify` 切換 category、`/notify_quiet` 設定免打擾、`/notify_reset` 一鍵還原預設。",
        fields=fields,
    )


class _CategoryToggleSelect(discord.ui.Select):
    def __init__(self, pref: DiscordNotificationPreference) -> None:
        prefs = pref.preferences or {}
        options = [
            discord.SelectOption(
                label=_CATEGORY_LABEL[key],
                value=key,
                default=prefs.get(key, DEFAULT_DM_CATEGORIES.get(key, True)),
                description="勾選表示開啟，取消勾選表示關閉",
            )
            for key in _CATEGORY_LABEL
        ]
        super().__init__(
            placeholder="勾選你要訂閱的通知 category",
            min_values=0,
            max_values=len(options),
            options=options,
        )
        self.pref_user_id = pref.user_id

    async def callback(self, interaction: discord.Interaction) -> None:
        chosen = set(self.values)
        async with AsyncSessionLocal() as db:
            pref = await _get_or_create_preference(db, self.pref_user_id)
            updated = {key: (key in chosen) for key in _CATEGORY_LABEL}
            pref.preferences = updated
            await audit_svc.record(
                db,
                entity_type="discord_notification_preference",
                entity_id=str(self.pref_user_id),
                action="discord.notify.update",
                actor_id=str(self.pref_user_id),
                actor_email=None,
                meta={"preferences": updated},
                summary="Discord 通知偏好更新",
            )
            await db.commit()
            refreshed = await _get_or_create_preference(db, self.pref_user_id)
            embed = _prefs_embed(refreshed)
        await interaction.response.edit_message(
            content=None,
            embeds=[discord.Embed.from_dict(embed)],
            view=_NotifyView(refreshed),
        )


class _DigestToggleButton(discord.ui.Button):
    def __init__(self, pref: DiscordNotificationPreference, key: str, label: str) -> None:
        enabled = getattr(pref, key)
        super().__init__(
            label=f"{label}：{'開' if enabled else '關'}",
            style=discord.ButtonStyle.success if enabled else discord.ButtonStyle.secondary,
            row=1,
        )
        self.pref_user_id = pref.user_id
        self.key = key
        self.label_text = label

    async def callback(self, interaction: discord.Interaction) -> None:
        async with AsyncSessionLocal() as db:
            pref = await _get_or_create_preference(db, self.pref_user_id)
            setattr(pref, self.key, not getattr(pref, self.key))
            await audit_svc.record(
                db,
                entity_type="discord_notification_preference",
                entity_id=str(self.pref_user_id),
                action=f"discord.notify.{self.key}",
                actor_id=str(self.pref_user_id),
                actor_email=None,
                meta={self.key: getattr(pref, self.key)},
                summary=f"Discord 通知偏好切換 {self.key}",
            )
            await db.commit()
            refreshed = await _get_or_create_preference(db, self.pref_user_id)
            embed = _prefs_embed(refreshed)
        await interaction.response.edit_message(
            content=None,
            embeds=[discord.Embed.from_dict(embed)],
            view=_NotifyView(refreshed),
        )


class _NotifyView(discord.ui.View):
    def __init__(self, pref: DiscordNotificationPreference) -> None:
        super().__init__(timeout=300)
        self.add_item(_CategoryToggleSelect(pref))
        self.add_item(_DigestToggleButton(pref, "digest_daily_enabled", "每日摘要"))
        self.add_item(_DigestToggleButton(pref, "digest_weekly_enabled", "每週摘要"))


class NotifyCog(commands.Cog):
    """個人 Discord 通知偏好設定。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="notify", description="設定 Discord DM 通知偏好")
    async def notify(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            pref = await _get_or_create_preference(db, user.id)
            await db.commit()
            pref = await _get_or_create_preference(db, user.id)
        embed = _prefs_embed(pref)
        await interaction.response.send_message(
            embed=discord.Embed.from_dict(embed),
            view=_NotifyView(pref),
            ephemeral=True,
        )

    @app_commands.command(name="notify_status", description="查看 Discord 通知偏好")
    async def notify_status(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            pref = await _get_or_create_preference(db, user.id)
            await db.commit()
        await interaction.response.send_message(
            embed=discord.Embed.from_dict(_prefs_embed(pref)), ephemeral=True
        )

    @app_commands.command(name="notify_reset", description="把通知偏好還原為預設")
    async def notify_reset(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            pref = await _get_or_create_preference(db, user.id)
            pref.preferences = dict(DEFAULT_DM_CATEGORIES)
            pref.digest_daily_enabled = True
            pref.digest_weekly_enabled = False
            pref.quiet_hours_start = None
            pref.quiet_hours_end = None
            pref.timezone = "Asia/Taipei"
            await audit_svc.record(
                db,
                entity_type="discord_notification_preference",
                entity_id=str(user.id),
                action="discord.notify.reset",
                actor_id=str(user.id),
                actor_email=user.email,
                meta={},
                summary="Discord 通知偏好還原預設",
            )
            await db.commit()
            refreshed = await _get_or_create_preference(db, user.id)
        await interaction.response.send_message(
            embed=discord.Embed.from_dict(_prefs_embed(refreshed)), ephemeral=True
        )

    @app_commands.command(name="notify_quiet", description="設定免打擾時段（HH:MM 24 小時制）")
    @app_commands.describe(
        start="開始時間，例如 22:00（留空表示停用）",
        end="結束時間，例如 08:00",
    )
    async def notify_quiet(
        self,
        interaction: discord.Interaction,
        start: str | None = None,
        end: str | None = None,
    ) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        if start is None and end is None:
            new_start = new_end = None
        else:
            if (
                not start
                or not end
                or not _QUIET_PATTERN.match(start)
                or not _QUIET_PATTERN.match(end)
            ):
                await interaction.response.send_message(
                    "時間格式請用 HH:MM，例如 22:00 與 08:00。", ephemeral=True
                )
                return
            sh, sm = map(int, start.split(":"))
            eh, em = map(int, end.split(":"))
            new_start = time(sh, sm)
            new_end = time(eh, em)
        async with AsyncSessionLocal() as db:
            pref = await _get_or_create_preference(db, user.id)
            pref.quiet_hours_start = new_start
            pref.quiet_hours_end = new_end
            await audit_svc.record(
                db,
                entity_type="discord_notification_preference",
                entity_id=str(user.id),
                action="discord.notify.quiet_hours",
                actor_id=str(user.id),
                actor_email=user.email,
                meta={
                    "start": start,
                    "end": end,
                    "set_at": datetime.now(UTC).isoformat(),
                },
                summary="Discord 通知 quiet hours 更新",
            )
            await db.commit()
            refreshed = await _get_or_create_preference(db, user.id)
        await interaction.response.send_message(
            embed=discord.Embed.from_dict(_prefs_embed(refreshed)), ephemeral=True
        )
