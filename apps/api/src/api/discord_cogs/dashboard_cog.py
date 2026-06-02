"""/dashboard 統一工作台 cog。

一個 ephemeral embed + Select Menu 切換 tab，每個 tab 翻頁顯示對應待辦。
不重做對象選擇邏輯——資料來源都是既有 task_inbox + petition_svc。
"""

from __future__ import annotations

import logging
import uuid

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import select

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import require_bound_user
from api.models.calendar import CalendarEvent, CalendarEventParticipant
from api.models.meeting import Meeting, MeetingStatus
from api.models.org import Position, UserPosition
from api.models.user import User
from api.schemas.task import TaskInboxResponse, TaskItem
from api.services import petition as petition_svc
from api.services.discord_bot import create_open_url
from api.services.discord_embeds import Domain, Severity, build_embed, default_action_row
from api.services.permission import active_tenure_filter
from api.services.task_inbox import build_task_inbox

logger = logging.getLogger(__name__)

_PAGE_SIZE = 5
_TAB_ORDER = ("overview", "tasks", "documents", "petitions", "meetings", "calendar")
_TAB_LABEL = {
    "overview": "📊 總覽",
    "tasks": "✅ 待辦",
    "documents": "📄 公文",
    "petitions": "🗳️ 陳情",
    "meetings": "🤝 會議",
    "calendar": "📅 行事曆",
}


async def _user_positions(db, user_id: uuid.UUID) -> list[str]:
    from datetime import UTC, datetime

    today = datetime.now(UTC).date()
    rows = await db.execute(
        select(Position.name)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == user_id)
        .where(*active_tenure_filter(today))
        .distinct()
    )
    return [str(r[0]) for r in rows.all()]


async def _gather_dashboard(db, user: User) -> dict:
    inbox: TaskInboxResponse = await build_task_inbox(db, user)
    positions = await _user_positions(db, user.id)
    petitions = await petition_svc.list_cases(db, assigned_to_id=user.id, limit=25)
    from datetime import UTC, datetime, timedelta

    now = datetime.now(UTC)
    horizon = now + timedelta(days=14)
    meeting_rows = await db.execute(
        select(Meeting)
        .where(Meeting.starts_at.is_not(None))
        .where(Meeting.starts_at >= now)
        .where(Meeting.starts_at <= horizon)
        .where(Meeting.status.in_([MeetingStatus.DRAFT, MeetingStatus.IN_PROGRESS]))
        .order_by(Meeting.starts_at)
        .limit(25)
    )
    meetings = list(meeting_rows.scalars().all())
    calendar_rows = await db.execute(
        select(CalendarEvent)
        .join(
            CalendarEventParticipant,
            CalendarEventParticipant.event_id == CalendarEvent.id,
        )
        .where(CalendarEventParticipant.user_id == user.id)
        .where(CalendarEvent.starts_at >= now)
        .where(CalendarEvent.starts_at <= horizon)
        .where(CalendarEvent.is_active.is_(True))
        .order_by(CalendarEvent.starts_at)
        .limit(25)
    )
    calendar = list(calendar_rows.scalars().all())
    documents = [item for item in inbox.items if item.module == "document"]
    return {
        "inbox": inbox,
        "positions": positions,
        "documents": documents,
        "petitions": petitions,
        "meetings": meetings,
        "calendar": calendar,
    }


def _overview_embed(user: User, data: dict) -> dict:
    fields = [
        {"name": "未讀待辦", "value": str(data["inbox"].total), "inline": True},
        {"name": "公文待核", "value": str(len(data["documents"])), "inline": True},
        {"name": "陳情待辦", "value": str(len(data["petitions"])), "inline": True},
        {"name": "兩週內會議", "value": str(len(data["meetings"])), "inline": True},
        {"name": "兩週內行事曆", "value": str(len(data["calendar"])), "inline": True},
        {
            "name": "現任職位",
            "value": "、".join(data["positions"]) or "—",
            "inline": False,
        },
    ]
    return build_embed(
        Domain.SYSTEM,
        Severity.INFO,
        title=f"HCCA 工作台｜{user.display_name}",
        body="使用下方下拉切換 tab。每頁顯示 5 筆。",
        fields=fields,
    )


def _list_embed(domain: Domain, title: str, items: list, render, page: int) -> dict:
    start = page * _PAGE_SIZE
    sliced = items[start : start + _PAGE_SIZE]
    fields = [render(it) for it in sliced] or [
        {"name": "—", "value": "目前沒有資料。", "inline": False}
    ]
    total_pages = max(1, (len(items) + _PAGE_SIZE - 1) // _PAGE_SIZE)
    return build_embed(
        domain,
        Severity.INFO,
        title=title,
        body=f"第 {page + 1} / {total_pages} 頁，共 {len(items)} 筆",
        fields=fields,
    )


def _task_field(item: TaskItem) -> dict:
    subtitle = item.subtitle or ""
    if item.due_at:
        subtitle = f"{subtitle}｜截止 {item.due_at.strftime('%Y-%m-%d %H:%M')}".strip("｜")
    return {"name": item.title[:200], "value": subtitle or "—", "inline": False}


def _meeting_field(meeting) -> dict:
    return {
        "name": meeting.title[:200],
        "value": (
            f"開會時間：{meeting.starts_at.strftime('%Y-%m-%d %H:%M')}\n"
            f"地點：{meeting.location or '—'}"
        ),
        "inline": False,
    }


def _calendar_field(event) -> dict:
    return {
        "name": event.title[:200],
        "value": (
            f"時間：{event.starts_at.strftime('%Y-%m-%d %H:%M')}\n"
            f"地點：{event.location or '—'}"
        ),
        "inline": False,
    }


def _petition_field(case) -> dict:
    return {
        "name": f"{case.case_number}｜{case.title[:120]}",
        "value": f"狀態：{case.status}",
        "inline": False,
    }


class _DashboardView(discord.ui.View):
    def __init__(self, user: User, data: dict) -> None:
        super().__init__(timeout=300)
        self.user = user
        self.data = data
        self.tab = "overview"
        self.page = 0
        self.add_item(_TabSelect(self))
        self.prev_button = _PageButton(self, direction=-1, label="◀")
        self.next_button = _PageButton(self, direction=1, label="▶")
        self.add_item(self.prev_button)
        self.add_item(self.next_button)

    def render(self) -> dict:
        if self.tab == "overview":
            return _overview_embed(self.user, self.data)
        if self.tab == "tasks":
            items = self.data["inbox"].items
            return _list_embed(Domain.TASK, "待辦清單", items, _task_field, self.page)
        if self.tab == "documents":
            items = self.data["documents"]
            return _list_embed(Domain.DOCUMENT, "公文待核", items, _task_field, self.page)
        if self.tab == "petitions":
            items = self.data["petitions"]
            return _list_embed(Domain.PETITION, "陳情待辦", items, _petition_field, self.page)
        if self.tab == "meetings":
            return _list_embed(
                Domain.MEETING, "兩週內會議", self.data["meetings"], _meeting_field, self.page
            )
        if self.tab == "calendar":
            return _list_embed(
                Domain.CALENDAR,
                "兩週內行事曆",
                self.data["calendar"],
                _calendar_field,
                self.page,
            )
        return _overview_embed(self.user, self.data)

    def items_for_current_tab(self) -> list:
        if self.tab == "tasks":
            return self.data["inbox"].items
        if self.tab == "documents":
            return self.data["documents"]
        if self.tab == "petitions":
            return self.data["petitions"]
        if self.tab == "meetings":
            return self.data["meetings"]
        if self.tab == "calendar":
            return self.data["calendar"]
        return []


class _TabSelect(discord.ui.Select):
    def __init__(self, parent: _DashboardView) -> None:
        super().__init__(
            placeholder="切換 tab",
            options=[
                discord.SelectOption(label=_TAB_LABEL[tab], value=tab, default=(tab == "overview"))
                for tab in _TAB_ORDER
            ],
            row=0,
        )
        self.parent_view = parent

    async def callback(self, interaction: discord.Interaction) -> None:
        self.parent_view.tab = self.values[0]
        self.parent_view.page = 0
        await interaction.response.edit_message(
            embed=discord.Embed.from_dict(self.parent_view.render()),
            view=self.parent_view,
        )


class _PageButton(discord.ui.Button):
    def __init__(self, parent: _DashboardView, *, direction: int, label: str) -> None:
        super().__init__(
            style=discord.ButtonStyle.secondary,
            label=label,
            row=1,
        )
        self.parent_view = parent
        self.direction = direction

    async def callback(self, interaction: discord.Interaction) -> None:
        items = self.parent_view.items_for_current_tab()
        total_pages = max(1, (len(items) + _PAGE_SIZE - 1) // _PAGE_SIZE)
        self.parent_view.page = (self.parent_view.page + self.direction) % total_pages
        await interaction.response.edit_message(
            embed=discord.Embed.from_dict(self.parent_view.render()),
            view=self.parent_view,
        )


class DashboardCog(commands.Cog):
    """整合 task_inbox + meeting + calendar + petition 的個人工作台。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="dashboard", description="開啟 HCCA 個人工作台")
    async def dashboard(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        await interaction.response.defer(ephemeral=True)
        async with AsyncSessionLocal() as db:
            data = await _gather_dashboard(db, user)
            open_url = await create_open_url(user.id, "/dashboard")
        view = _DashboardView(user, data)
        components = default_action_row(open_url=open_url)
        if components:
            # 把「打開平台」按鈕也掛到 view 上
            for child in components["components"]:
                view.add_item(
                    discord.ui.Button(
                        style=discord.ButtonStyle.link,
                        label=child["label"],
                        url=child["url"],
                        row=2,
                    )
                )
        await interaction.followup.send(
            embed=discord.Embed.from_dict(view.render()),
            view=view,
            ephemeral=True,
        )
