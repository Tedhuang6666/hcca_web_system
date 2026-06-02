"""瀏覽 cog：把平台主要 listing 直接搬進 Discord，省一次切到瀏覽器。

指令：
- /announcements：近期公告
- /meetings_upcoming：兩週內會議
- /events_today：今日行事曆
- /surveys_open：開放中的問卷
- /regulations_recent：近期法規異動

學餐已獨立到 meal_cog（/meal_today 等）。
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import reply_embed, require_bound_user
from api.models.announcement import Announcement
from api.models.calendar import CalendarEvent
from api.models.meeting import Meeting, MeetingStatus
from api.models.regulation import Regulation
from api.models.survey import Survey, SurveyStatus
from api.services.discord_bot import create_open_url
from api.services.discord_embeds import Domain, Severity

_UPCOMING_MEETING_STATUSES = (
    MeetingStatus.DRAFT,
    MeetingStatus.CONFIRMED,
    MeetingStatus.CHECKIN,
    MeetingStatus.ACTIVE,
    MeetingStatus.BREAK,
    MeetingStatus.PAUSED,
)


class BrowseCog(commands.Cog):
    """把平台 listing 帶進 Discord。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="announcements", description="近期公告（最多 10 則）")
    @app_commands.describe(urgent_only="只看緊急公告")
    async def announcements(
        self, interaction: discord.Interaction, urgent_only: bool = False
    ) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        async with AsyncSessionLocal() as db:
            stmt = (
                select(Announcement)
                .where(Announcement.is_published.is_(True))
                .order_by(Announcement.published_at.desc().nullslast())
                .limit(10)
            )
            if urgent_only:
                stmt = stmt.where(Announcement.is_urgent.is_(True))
            rows = (await db.execute(stmt)).scalars().all()
        if not rows:
            await reply_embed(
                interaction,
                domain=Domain.ANNOUNCEMENT,
                severity=Severity.NEUTRAL,
                title="目前沒有公告" + ("（緊急）" if urgent_only else ""),
            )
            return
        fields = []
        for ann in rows:
            badge = "🚨 緊急" if ann.is_urgent else "📢"
            time_str = ann.published_at.strftime("%m-%d %H:%M") if ann.published_at else "—"
            url = await create_open_url(user.id, f"/announcements/{ann.id}")
            fields.append(
                {
                    "name": f"{badge} {ann.title[:200]}",
                    "value": f"{time_str}\n[打開]({url})",
                    "inline": False,
                }
            )
        await reply_embed(
            interaction,
            domain=Domain.ANNOUNCEMENT,
            severity=Severity.URGENT if urgent_only else Severity.INFO,
            title=f"近期公告（共 {len(rows)} 則）",
            fields=fields,
            open_url="/announcements",
        )

    @app_commands.command(name="meetings_upcoming", description="兩週內會議（最多 10 場）")
    async def meetings_upcoming(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        now = datetime.now(UTC)
        horizon = now + timedelta(days=14)
        async with AsyncSessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        select(Meeting)
                        .where(Meeting.starts_at.is_not(None))
                        .where(Meeting.starts_at >= now)
                        .where(Meeting.starts_at <= horizon)
                        .where(Meeting.status.in_(_UPCOMING_MEETING_STATUSES))
                        .order_by(Meeting.starts_at)
                        .limit(10)
                    )
                )
                .scalars()
                .all()
            )
        if not rows:
            await reply_embed(
                interaction,
                domain=Domain.MEETING,
                severity=Severity.NEUTRAL,
                title="兩週內沒有會議",
            )
            return
        fields = []
        for m in rows:
            url = await create_open_url(user.id, f"/meetings/{m.id}")
            fields.append(
                {
                    "name": f"🤝 {m.title[:200]}",
                    "value": (
                        f"⏰ {m.starts_at.strftime('%m-%d %H:%M')}\n"
                        f"📍 {m.location or '—'}｜狀態：{m.status}\n"
                        f"[打開]({url})"
                    ),
                    "inline": False,
                }
            )
        await reply_embed(
            interaction,
            domain=Domain.MEETING,
            severity=Severity.INFO,
            title=f"兩週內會議（共 {len(rows)} 場）",
            fields=fields,
            open_url="/meetings",
        )

    @app_commands.command(name="events_today", description="今日行事曆事件")
    async def events_today(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        now = datetime.now(UTC)
        day_start = datetime.combine(now.date(), time.min, tzinfo=UTC)
        day_end = day_start + timedelta(days=1)
        async with AsyncSessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        select(CalendarEvent)
                        .where(CalendarEvent.starts_at >= day_start)
                        .where(CalendarEvent.starts_at < day_end)
                        .where(CalendarEvent.is_active.is_(True))
                        .order_by(CalendarEvent.starts_at)
                        .limit(10)
                    )
                )
                .scalars()
                .all()
            )
        if not rows:
            await reply_embed(
                interaction,
                domain=Domain.CALENDAR,
                severity=Severity.NEUTRAL,
                title="今天沒有行事曆事件",
            )
            return
        fields = []
        for e in rows:
            url = await create_open_url(user.id, e.href or f"/calendar/events/{e.id}")
            fields.append(
                {
                    "name": f"📅 {e.title[:200]}",
                    "value": (
                        f"⏰ {e.starts_at.strftime('%H:%M')}"
                        + (f" → {e.ends_at.strftime('%H:%M')}" if e.ends_at else "")
                        + f"\n📍 {e.location or '—'}\n[打開]({url})"
                    ),
                    "inline": False,
                }
            )
        await reply_embed(
            interaction,
            domain=Domain.CALENDAR,
            severity=Severity.INFO,
            title=f"今日行事曆（{now.date().isoformat()}）",
            fields=fields,
            open_url="/calendar",
        )

    @app_commands.command(name="surveys_open", description="目前開放的問卷")
    async def surveys_open(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        async with AsyncSessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        select(Survey)
                        .where(Survey.status == SurveyStatus.OPEN)
                        .order_by(Survey.closes_at.asc().nullslast())
                        .limit(10)
                    )
                )
                .scalars()
                .all()
            )
        if not rows:
            await reply_embed(
                interaction,
                domain=Domain.SURVEY,
                severity=Severity.NEUTRAL,
                title="目前沒有開放中的問卷",
            )
            return
        fields = []
        for s in rows:
            url = await create_open_url(user.id, f"/surveys/{s.id}")
            close_str = s.closes_at.strftime("%m-%d %H:%M") if s.closes_at else "無截止"
            anon = "🙈 匿名" if s.is_anonymous else "📝 具名"
            fields.append(
                {
                    "name": f"📝 {s.title[:200]}",
                    "value": (f"{anon}｜截止：{close_str}\n[填寫]({url})"),
                    "inline": False,
                }
            )
        await reply_embed(
            interaction,
            domain=Domain.SURVEY,
            severity=Severity.INFO,
            title=f"開放問卷（共 {len(rows)} 份）",
            fields=fields,
            open_url="/surveys",
        )

    @app_commands.command(name="regulations_recent", description="近期法規異動")
    async def regulations_recent(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        async with AsyncSessionLocal() as db:
            rows = (
                (
                    await db.execute(
                        select(Regulation)
                        .where(Regulation.is_active.is_(True))
                        .order_by(Regulation.updated_at.desc())
                        .limit(10)
                    )
                )
                .scalars()
                .all()
            )
        if not rows:
            await reply_embed(
                interaction,
                domain=Domain.REGULATION,
                severity=Severity.NEUTRAL,
                title="目前沒有法規資料",
            )
            return
        fields = []
        for r in rows:
            url = await create_open_url(user.id, f"/regulations/{r.id}")
            updated_str = r.updated_at.strftime("%m-%d") if r.updated_at else "—"
            badge = "📌 已公布" if r.published_at else "📝 草擬中"
            fields.append(
                {
                    "name": f"⚖️ {r.title[:200]} v{r.version}",
                    "value": f"{badge}｜流程：{r.workflow_status}\n更新：{updated_str}｜[打開]({url})",
                    "inline": False,
                }
            )
        await reply_embed(
            interaction,
            domain=Domain.REGULATION,
            severity=Severity.INFO,
            title=f"近期法規（共 {len(rows)} 件）",
            fields=fields,
            open_url="/regulations",
        )
