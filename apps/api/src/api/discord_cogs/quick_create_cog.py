"""快速建立 cog：/announce /meeting_create /calendar_add /survey_quick。

提供 Discord modal 表單在 30 秒內建立公告/會議/行事曆/問卷草稿。
所有建立操作都使用使用者「第一個 active 任期」的 org_id；無任期者拒絕建立。
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select

from api.core.database import AsyncSessionLocal
from api.discord_cogs._autocomplete import due_at_autocomplete, parse_due_at
from api.discord_cogs._helpers import has_permission, require_bound_user
from api.models.org import Position, UserPosition
from api.models.user import User
from api.schemas.announcement import AnnouncementAudience, AnnouncementCreate
from api.schemas.calendar import CalendarEventCreate
from api.schemas.meeting import MeetingCreate
from api.schemas.survey import SurveyCreate
from api.services import announcement as announcement_svc
from api.services import audit as audit_svc
from api.services import calendar as calendar_svc
from api.services import meeting as meeting_svc
from api.services import survey as survey_svc
from api.services.permission import active_tenure_filter, get_user_permission_codes

logger = logging.getLogger(__name__)


async def _user_primary_org(db, user_id: uuid.UUID) -> uuid.UUID | None:
    today = datetime.now(UTC).date()
    row = await db.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == user_id)
        .where(*active_tenure_filter(today))
        .limit(1)
    )
    value = row.scalar_one_or_none()
    return value


class _AnnounceModal(discord.ui.Modal, title="建立公告"):
    title_input = discord.ui.TextInput(label="公告標題", max_length=200, required=True)
    body_input = discord.ui.TextInput(
        label="公告內容（純文字）",
        style=discord.TextStyle.paragraph,
        max_length=4000,
        required=True,
    )
    urgent_input = discord.ui.TextInput(
        label="是否緊急？輸入 yes 或 no",
        default="no",
        max_length=10,
        required=True,
    )

    def __init__(self, user: User) -> None:
        super().__init__()
        self.platform_user = user

    async def on_submit(self, interaction: discord.Interaction) -> None:
        is_urgent = self.urgent_input.value.strip().lower() in {"yes", "y", "1", "緊急"}
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, self.platform_user.id)
            if not has_permission(self.platform_user, codes, "announcement:create"):
                await interaction.response.send_message(
                    "你沒有建立公告的權限。", ephemeral=True
                )
                return
            org_id = await _user_primary_org(db, self.platform_user.id)
            if org_id is None:
                await interaction.response.send_message(
                    "找不到你的所屬機關。請先在平台確認任期。", ephemeral=True
                )
                return
            payload = AnnouncementCreate(
                title=str(self.title_input.value),
                content={
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": str(self.body_input.value)}],
                        }
                    ],
                },
                is_urgent=is_urgent,
                org_id=org_id,
                audience_type=AnnouncementAudience.ALL,
            )
            ann = await announcement_svc.create_announcement(
                db, data=payload, created_by=self.platform_user.id
            )
            await audit_svc.record(
                db,
                entity_type="announcement",
                entity_id=str(ann.id),
                action="discord.announcement.create",
                actor_id=str(self.platform_user.id),
                actor_email=self.platform_user.email,
                meta={"discord_interaction_id": str(interaction.id)},
                summary=f"Discord 建立公告「{ann.title}」",
            )
            await db.commit()
        await interaction.response.send_message(
            f"已建立公告「{ann.title}」，請至平台補完內容並發布。", ephemeral=True
        )


class _MeetingModal(discord.ui.Modal, title="建立會議"):
    title_input = discord.ui.TextInput(label="會議標題", max_length=200, required=True)
    starts_at_input = discord.ui.TextInput(
        label="開會時間（ISO，例 2026-06-05T14:00+08:00）",
        max_length=40,
        required=False,
    )
    location_input = discord.ui.TextInput(label="地點", max_length=200, required=False)

    def __init__(self, user: User) -> None:
        super().__init__()
        self.platform_user = user

    async def on_submit(self, interaction: discord.Interaction) -> None:
        starts_at = parse_due_at(self.starts_at_input.value or None)
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, self.platform_user.id)
            if not has_permission(self.platform_user, codes, "meeting:create"):
                await interaction.response.send_message("你沒有建立會議的權限。", ephemeral=True)
                return
            org_id = await _user_primary_org(db, self.platform_user.id)
            if org_id is None:
                await interaction.response.send_message(
                    "找不到你的所屬機關，無法建立會議。", ephemeral=True
                )
                return
            data = MeetingCreate(
                title=str(self.title_input.value),
                org_id=org_id,
                location=str(self.location_input.value) or None,
                starts_at=starts_at,
            )
            meeting = await meeting_svc.create_meeting(
                db, data=data, created_by=self.platform_user.id
            )
            await audit_svc.record(
                db,
                entity_type="meeting",
                entity_id=str(meeting.id),
                action="discord.meeting.create",
                actor_id=str(self.platform_user.id),
                actor_email=self.platform_user.email,
                meta={"discord_interaction_id": str(interaction.id)},
                summary=f"Discord 建立會議「{meeting.title}」",
            )
            await db.commit()
        await interaction.response.send_message(
            f"已建立會議「{meeting.title}」（草稿）。請至平台補上議程與通知。",
            ephemeral=True,
        )


class _CalendarModal(discord.ui.Modal, title="建立行事曆事件"):
    title_input = discord.ui.TextInput(label="事件名稱", max_length=200, required=True)
    starts_at_input = discord.ui.TextInput(
        label="開始時間（ISO，例 2026-06-05T14:00+08:00）",
        max_length=40,
        required=True,
    )
    location_input = discord.ui.TextInput(label="地點", max_length=200, required=False)
    description_input = discord.ui.TextInput(
        label="說明", style=discord.TextStyle.paragraph, max_length=1000, required=False
    )

    def __init__(self, user: User) -> None:
        super().__init__()
        self.platform_user = user

    async def on_submit(self, interaction: discord.Interaction) -> None:
        starts_at = parse_due_at(self.starts_at_input.value)
        if starts_at is None:
            await interaction.response.send_message(
                "開始時間格式無法解析，請用 ISO。", ephemeral=True
            )
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, self.platform_user.id)
            if not has_permission(self.platform_user, codes, "calendar:create"):
                await interaction.response.send_message(
                    "你沒有建立行事曆的權限。", ephemeral=True
                )
                return
            org_id = await _user_primary_org(db, self.platform_user.id)
            if org_id is None:
                await interaction.response.send_message(
                    "找不到你的所屬機關。", ephemeral=True
                )
                return
            data = CalendarEventCreate(
                org_id=org_id,
                title=str(self.title_input.value),
                description=str(self.description_input.value) or None,
                location=str(self.location_input.value) or None,
                starts_at=starts_at,
            )
            event = await calendar_svc.create_event(
                db, data=data, created_by=self.platform_user.id
            )
            await audit_svc.record(
                db,
                entity_type="calendar_event",
                entity_id=str(event.id),
                action="discord.calendar.create",
                actor_id=str(self.platform_user.id),
                actor_email=self.platform_user.email,
                meta={"discord_interaction_id": str(interaction.id)},
                summary=f"Discord 建立行事曆「{event.title}」",
            )
            await db.commit()
        await interaction.response.send_message(
            f"已建立行事曆事件「{event.title}」。", ephemeral=True
        )


class _SurveyModal(discord.ui.Modal, title="快速建立問卷"):
    title_input = discord.ui.TextInput(label="問卷標題", max_length=300, required=True)
    description_input = discord.ui.TextInput(
        label="說明",
        style=discord.TextStyle.paragraph,
        max_length=2000,
        required=False,
    )
    anonymous_input = discord.ui.TextInput(
        label="是否匿名？輸入 yes 或 no",
        default="no",
        max_length=10,
        required=True,
    )

    def __init__(self, user: User) -> None:
        super().__init__()
        self.platform_user = user

    async def on_submit(self, interaction: discord.Interaction) -> None:
        is_anonymous = self.anonymous_input.value.strip().lower() in {"yes", "y", "1", "匿名"}
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, self.platform_user.id)
            if not has_permission(self.platform_user, codes, "survey:create"):
                await interaction.response.send_message(
                    "你沒有建立問卷的權限。", ephemeral=True
                )
                return
            org_id = await _user_primary_org(db, self.platform_user.id)
            if org_id is None:
                await interaction.response.send_message(
                    "找不到你的所屬機關。", ephemeral=True
                )
                return
            data = SurveyCreate(
                title=str(self.title_input.value),
                description=str(self.description_input.value) or None,
                is_anonymous=is_anonymous,
                org_id=org_id,
                closes_at=datetime.now(UTC) + timedelta(days=7),
            )
            survey = await survey_svc.create_survey(
                db, data=data, created_by=self.platform_user.id
            )
            await audit_svc.record(
                db,
                entity_type="survey",
                entity_id=str(survey.id),
                action="discord.survey.create",
                actor_id=str(self.platform_user.id),
                actor_email=self.platform_user.email,
                meta={"discord_interaction_id": str(interaction.id)},
                summary=f"Discord 建立問卷「{survey.title}」",
            )
            await db.commit()
        await interaction.response.send_message(
            f"已建立問卷草稿「{survey.title}」，請至平台補題目並開放。", ephemeral=True
        )


class QuickCreateCog(commands.Cog):
    """從 Discord 30 秒內建立公告/會議/行事曆/問卷。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="announce", description="開啟公告建立表單")
    async def announce(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.send_modal(_AnnounceModal(user))

    @app_commands.command(name="meeting_create", description="開啟會議建立表單")
    async def meeting_create(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.send_modal(_MeetingModal(user))

    @app_commands.command(name="calendar_add", description="開啟行事曆建立表單")
    async def calendar_add(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.send_modal(_CalendarModal(user))

    @app_commands.command(name="survey_quick", description="開啟問卷建立表單")
    async def survey_quick(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.send_modal(_SurveyModal(user))
