"""Discord slash commands and interactive views.

All platform reads and writes go through PlatformApiClient.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

import discord
from discord import app_commands
from discord.ext import commands

from hcca_discord_bot.api_client import (
    PlatformApiClient,
    PlatformCommandError,
    PlatformUnavailableError,
)

_CATEGORY_LABEL = {
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
_TIMEOUT_PRESETS = [
    ("5 分鐘", 5),
    ("10 分鐘", 10),
    ("30 分鐘", 30),
    ("1 小時", 60),
    ("4 小時", 240),
    ("1 天", 1440),
    ("3 天", 4320),
    ("1 週", 10080),
]


def _client(interaction: discord.Interaction) -> PlatformApiClient:
    return interaction.client.platform  # type: ignore[attr-defined,no-any-return]


async def _command(
    interaction: discord.Interaction,
    operation: str,
    arguments: dict[str, Any] | None = None,
    *,
    silent: bool = False,
) -> dict[str, Any] | None:
    try:
        return await _client(interaction).command(
            operation,
            discord_user_id=interaction.user.id,
            interaction_id=interaction.id,
            guild_id=interaction.guild_id,
            arguments=arguments,
        )
    except PlatformCommandError as exc:
        if silent:
            return None
        sender = (
            interaction.followup.send
            if interaction.response.is_done()
            else interaction.response.send_message
        )
        await sender(str(exc), ephemeral=True)
        return None
    except PlatformUnavailableError:
        if silent:
            return None
        sender = (
            interaction.followup.send
            if interaction.response.is_done()
            else interaction.response.send_message
        )
        await sender("平台 API 暫時無法連線，請稍後再試。", ephemeral=True)
        return None


def _parse_datetime(value: str | None) -> str | None:
    if not value:
        return None
    presets = {
        "1h": datetime.now().astimezone() + timedelta(hours=1),
        "tomorrow": datetime.now().astimezone() + timedelta(days=1),
        "7d": datetime.now().astimezone() + timedelta(days=7),
    }
    if value in presets:
        return presets[value].isoformat()
    try:
        return datetime.fromisoformat(value).isoformat()
    except ValueError:
        return None


async def _due_autocomplete(
    _interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    choices = [
        app_commands.Choice(name="1 小時後", value="1h"),
        app_commands.Choice(name="明天同一時間", value="tomorrow"),
        app_commands.Choice(name="7 天後", value="7d"),
    ]
    return [choice for choice in choices if current.lower() in choice.name.lower()][:25]


async def _timeout_autocomplete(
    _interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[int]]:
    return [
        app_commands.Choice(name=label, value=minutes)
        for label, minutes in _TIMEOUT_PRESETS
        if current.lower() in label.lower()
    ][:25]


async def _work_item_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    data = await _command(interaction, "work_item_choices", silent=True)
    if data is None:
        return []
    return [
        app_commands.Choice(name=item["title"][:100], value=item["id"])
        for item in data["items"]
        if current.lower() in item["title"].lower()
    ][:25]


async def _petition_autocomplete(
    interaction: discord.Interaction, current: str
) -> list[app_commands.Choice[str]]:
    data = await _command(interaction, "petition_choices", silent=True)
    if data is None:
        return []
    return [
        app_commands.Choice(
            name=f"{item['case_number']}｜{item['title']}"[:100],
            value=item["id"],
        )
        for item in data["items"]
        if current.lower() in f"{item['case_number']} {item['title']}".lower()
    ][:25]


class RejectDocumentModal(discord.ui.Modal, title="退回公文"):
    comment = discord.ui.TextInput(
        label="退件理由",
        style=discord.TextStyle.paragraph,
        max_length=1000,
    )

    def __init__(self, document_id: str, mode: str) -> None:
        super().__init__()
        self.document_id = document_id
        self.mode = mode

    async def on_submit(self, interaction: discord.Interaction) -> None:
        data = await _command(
            interaction,
            "document_reject",
            {
                "document_id": self.document_id,
                "mode": self.mode,
                "comment": str(self.comment.value),
            },
        )
        if data is not None:
            await interaction.response.send_message(f"已退回：{data['title']}", ephemeral=True)


class DocumentActionView(discord.ui.View):
    def __init__(self, document_id: str, open_url: str) -> None:
        super().__init__(timeout=300)
        self.document_id = document_id
        self.add_item(discord.ui.Button(label="查看全文", url=open_url))

    @discord.ui.button(label="核准", style=discord.ButtonStyle.success)
    async def approve(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        data = await _command(interaction, "document_approve", {"document_id": self.document_id})
        if data is not None:
            await interaction.response.send_message(f"已核准：{data['title']}", ephemeral=True)

    @discord.ui.button(label="退回承辦人", style=discord.ButtonStyle.danger)
    async def reject_creator(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_modal(RejectDocumentModal(self.document_id, "to_creator"))

    @discord.ui.button(label="退回上一關", style=discord.ButtonStyle.secondary)
    async def reject_previous(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_modal(RejectDocumentModal(self.document_id, "to_previous"))


class PetitionModal(discord.ui.Modal, title="建立陳情"):
    title_input = discord.ui.TextInput(label="標題", max_length=200)
    content_input = discord.ui.TextInput(
        label="內容",
        style=discord.TextStyle.paragraph,
        max_length=4000,
    )
    anonymous_input = discord.ui.TextInput(
        label="匿名送件？輸入 yes 或 no",
        default="yes",
        max_length=10,
    )

    async def on_submit(self, interaction: discord.Interaction) -> None:
        anonymous = self.anonymous_input.value.strip().lower() in {
            "yes",
            "y",
            "true",
            "1",
            "匿名",
        }
        data = await _command(
            interaction,
            "petition_create",
            {
                "title": str(self.title_input.value),
                "content": str(self.content_input.value),
                "anonymous": anonymous,
            },
        )
        if data is not None:
            await interaction.response.send_message(
                f"已建立陳情案件 {data['case_number']}。查詢驗證碼：{data['verification_code']}",
                ephemeral=True,
            )


class PetitionManageView(discord.ui.View):
    def __init__(self, case_id: str, open_url: str) -> None:
        super().__init__(timeout=300)
        self.case_id = case_id
        self.add_item(discord.ui.Button(label="開啟案件", url=open_url))

    @discord.ui.button(label="標記處理中", style=discord.ButtonStyle.primary)
    async def mark_in_progress(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        data = await _command(interaction, "petition_in_progress", {"case_id": self.case_id})
        if data is not None:
            await interaction.response.send_message(
                f"已更新案件 {data['case_number']}。", ephemeral=True
            )

    @discord.ui.button(label="新增內部備註", style=discord.ButtonStyle.secondary)
    async def note_hint(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_message(
            "內部備註請用 `/petition_note`，或開啟案件進入平台編輯。",
            ephemeral=True,
        )


def _preference_embed(data: dict[str, Any]) -> discord.Embed:
    embed = discord.Embed(
        title="Discord 通知偏好",
        description="用選單切換通知，按鈕切換摘要。",
        color=discord.Color.blurple(),
    )
    preferences = data.get("preferences", {})
    for key, label in _CATEGORY_LABEL.items():
        embed.add_field(
            name=label,
            value="已訂閱" if preferences.get(key, True) else "已關閉",
            inline=True,
        )
    embed.add_field(
        name="每日摘要",
        value="開" if data.get("digest_daily_enabled") else "關",
        inline=True,
    )
    embed.add_field(
        name="每週摘要",
        value="開" if data.get("digest_weekly_enabled") else "關",
        inline=True,
    )
    quiet = "未設定"
    if data.get("quiet_hours_start") and data.get("quiet_hours_end"):
        quiet = (
            f"{data['quiet_hours_start']} - {data['quiet_hours_end']} "
            f"({data.get('timezone', 'Asia/Taipei')})"
        )
    embed.add_field(name="免打擾", value=quiet, inline=True)
    return embed


class NotifyView(discord.ui.View):
    def __init__(self, data: dict[str, Any]) -> None:
        super().__init__(timeout=300)
        self.data = data
        preferences = data.get("preferences", {})
        self.add_item(
            NotifySelect(
                [
                    discord.SelectOption(
                        label=label,
                        value=key,
                        default=preferences.get(key, True),
                    )
                    for key, label in _CATEGORY_LABEL.items()
                ]
            )
        )
        self.add_item(
            DigestButton(
                "digest_daily_enabled",
                "每日摘要",
                bool(data.get("digest_daily_enabled")),
            )
        )
        self.add_item(
            DigestButton(
                "digest_weekly_enabled",
                "每週摘要",
                bool(data.get("digest_weekly_enabled")),
            )
        )


class NotifySelect(discord.ui.Select):
    def __init__(self, options: list[discord.SelectOption]) -> None:
        super().__init__(
            placeholder="勾選要訂閱的通知",
            min_values=0,
            max_values=len(options),
            options=options,
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        data = await _command(
            interaction,
            "notify_update",
            {"preferences": {key: key in self.values for key in _CATEGORY_LABEL}},
        )
        if data is not None:
            await interaction.response.edit_message(
                embed=_preference_embed(data),
                view=NotifyView(data),
            )


class DigestButton(discord.ui.Button):
    def __init__(self, key: str, label: str, enabled: bool) -> None:
        super().__init__(
            label=f"{label}：{'開' if enabled else '關'}",
            style=discord.ButtonStyle.success if enabled else discord.ButtonStyle.secondary,
            row=1,
        )
        self.key = key
        self.enabled = enabled

    async def callback(self, interaction: discord.Interaction) -> None:
        data = await _command(
            interaction,
            "notify_update",
            {self.key: not self.enabled},
        )
        if data is not None:
            await interaction.response.edit_message(
                embed=_preference_embed(data),
                view=NotifyView(data),
            )


class QuickCreateModal(discord.ui.Modal):
    title_input = discord.ui.TextInput(label="標題", max_length=300)
    detail_input = discord.ui.TextInput(
        label="內容 / 說明",
        style=discord.TextStyle.paragraph,
        max_length=4000,
        required=False,
    )
    extra_input = discord.ui.TextInput(
        label="時間 ISO / yes-no（依表單用途）",
        max_length=200,
        required=False,
    )
    location_input = discord.ui.TextInput(
        label="地點（會議 / 行事曆使用）",
        max_length=200,
        required=False,
    )

    def __init__(self, operation: str, title: str) -> None:
        super().__init__(title=title)
        self.operation = operation

    async def on_submit(self, interaction: discord.Interaction) -> None:
        title = str(self.title_input.value)
        detail = str(self.detail_input.value) or None
        extra = str(self.extra_input.value) or None
        location = str(self.location_input.value) or None
        arguments: dict[str, Any] = {"title": title}
        if self.operation == "announcement_create":
            arguments.update(
                body=detail or "",
                is_urgent=(extra or "").lower() in {"yes", "y", "1", "緊急"},
            )
        elif self.operation == "meeting_create":
            parsed = _parse_datetime(extra)
            arguments.update(location=location, starts_at=parsed)
        elif self.operation == "calendar_create":
            parsed = _parse_datetime(extra)
            if parsed is None:
                await interaction.response.send_message(
                    "開始時間格式無法解析，請用 ISO。", ephemeral=True
                )
                return
            arguments.update(description=detail, location=location, starts_at=parsed)
        else:
            arguments.update(
                description=detail,
                is_anonymous=(extra or "").lower() in {"yes", "y", "1", "匿名"},
            )
        data = await _command(interaction, self.operation, arguments)
        if data is not None:
            await interaction.response.send_message(f"已建立「{data['title']}」。", ephemeral=True)


class PlatformCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="ping", description="確認 HCCA Bot 狀態")
    async def ping(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(
            f"HCCA Bot online. latency={self.bot.latency * 1000:.0f}ms",
            ephemeral=True,
        )

    @app_commands.command(name="hcca_help", description="查看 HCCA Bot 功能摘要")
    async def hcca_help(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(
            "HCCA Bot\n"
            "個人：/me /tasks /dashboard /sync_me /notify\n"
            "工作：/assign_task /complete_task\n"
            "公文陳情：/documents_pending /petition /petitions_pending /petition_note /petition_channel\n"
            "建立：/announce /meeting_create /calendar_add /survey_quick\n"
            "系統與社群：admin:all 可用健康與 moderation 指令",
            ephemeral=True,
        )

    @app_commands.command(name="me", description="查看平台綁定與待辦摘要")
    async def me(self, interaction: discord.Interaction) -> None:
        context = await _command(interaction, "context")
        if context is None:
            return
        tasks = await _command(interaction, "tasks")
        if tasks is not None:
            await interaction.response.send_message(
                f"{context['display_name']}\n待辦：{tasks['total']} 件\n{tasks['open_url']}",
                ephemeral=True,
            )

    @app_commands.command(name="tasks", description="列出平台待辦")
    async def tasks(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "tasks")
        if data is None:
            return
        if not data["items"]:
            await interaction.response.send_message("目前沒有待辦。", ephemeral=True)
            return
        lines = [f"待辦共 {data['total']} 件："]
        lines.extend(f"- {item['title']}" for item in data["items"][:8])
        lines.append(data["open_url"])
        await interaction.response.send_message("\n".join(lines), ephemeral=True)

    @app_commands.command(name="dashboard", description="開啟 HCCA 個人工作台")
    async def dashboard(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "dashboard")
        if data is None:
            return
        embed = discord.Embed(
            title=f"HCCA 工作台｜{data['display_name']}",
            color=discord.Color.blurple(),
        )
        embed.add_field(name="待辦", value=str(len(data["tasks"])), inline=True)
        embed.add_field(name="陳情", value=str(len(data["petitions"])), inline=True)
        embed.add_field(name="兩週內會議", value=str(len(data["meetings"])), inline=True)
        embed.add_field(name="兩週內行事曆", value=str(len(data["calendar"])), inline=True)
        embed.add_field(
            name="現任職位",
            value="、".join(data["positions"]) or "—",
            inline=False,
        )
        if data["tasks"]:
            embed.add_field(
                name="近期待辦",
                value="\n".join(f"• {item['title']}" for item in data["tasks"][:5]),
                inline=False,
            )
        if data["petitions"]:
            embed.add_field(
                name="陳情待辦",
                value="\n".join(
                    f"• {item['case_number']}｜{item['title']}" for item in data["petitions"][:5]
                ),
                inline=False,
            )
        if data["meetings"]:
            embed.add_field(
                name="近期會議",
                value="\n".join(
                    f"• {item['title']}｜{item['starts_at'] or '時間未定'}"
                    for item in data["meetings"][:5]
                ),
                inline=False,
            )
        if data["calendar"]:
            embed.add_field(
                name="近期行事曆",
                value="\n".join(
                    f"• {item['title']}｜{item['starts_at']}" for item in data["calendar"][:5]
                ),
                inline=False,
            )
        view = discord.ui.View()
        view.add_item(discord.ui.Button(label="開啟平台", url=data["open_url"]))
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @app_commands.command(name="sync_me", description="同步自己的身分組與暱稱前綴")
    async def sync_me(self, interaction: discord.Interaction) -> None:
        if await _command(interaction, "sync_me") is not None:
            await interaction.response.send_message("已排程同步。", ephemeral=True)

    @app_commands.command(name="sync_all", description="排程同步所有已綁定成員")
    async def sync_all(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "sync_all")
        if data is not None:
            await interaction.response.send_message(
                f"已排程同步 {data['queued']} 位成員。", ephemeral=True
            )

    @app_commands.command(name="assign_task", description="指派工作與期限提醒")
    @app_commands.autocomplete(due_at=_due_autocomplete)
    async def assign_task(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        title: str,
        due_at: str | None = None,
        description: str | None = None,
    ) -> None:
        parsed = _parse_datetime(due_at)
        if due_at and parsed is None:
            await interaction.response.send_message("期限格式不接受。", ephemeral=True)
            return
        data = await _command(
            interaction,
            "assign_task",
            {
                "assignee_discord_user_id": str(member.id),
                "title": title,
                "due_at": parsed,
                "description": description,
            },
        )
        if data is not None:
            await interaction.response.send_message(
                f"已指派給 {member.mention}：{data['title']}", ephemeral=True
            )

    @app_commands.command(name="complete_task", description="完成一筆工作分配")
    @app_commands.autocomplete(task_id=_work_item_autocomplete)
    async def complete_task(self, interaction: discord.Interaction, task_id: str) -> None:
        data = await _command(interaction, "complete_task", {"task_id": task_id})
        if data is not None:
            await interaction.response.send_message(f"已完成：{data['title']}", ephemeral=True)

    @app_commands.command(name="documents_pending", description="列出待你審核的公文")
    async def documents_pending(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)
        data = await _command(interaction, "documents_pending")
        if data is None:
            return
        if not data["items"]:
            await interaction.followup.send("目前沒有待審公文。", ephemeral=True)
        for item in data["items"]:
            await interaction.followup.send(
                f"{item['title']}\n{item.get('subtitle') or ''}",
                view=DocumentActionView(item["document_id"], item["open_url"]),
                ephemeral=True,
            )

    @app_commands.command(name="petition", description="用私密表單建立陳情")
    async def petition(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(PetitionModal())

    @app_commands.command(name="petitions_pending", description="列出陳情待辦")
    async def petitions_pending(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(ephemeral=True)
        data = await _command(interaction, "petitions_pending")
        if data is None:
            return
        if not data["items"]:
            await interaction.followup.send("目前沒有指派給你的陳情。", ephemeral=True)
        for item in data["items"][:5]:
            await interaction.followup.send(
                f"{item['case_number']}｜{item['title']}",
                view=PetitionManageView(item["id"], item["open_url"]),
                ephemeral=True,
            )

    @app_commands.command(name="petition_note", description="新增陳情內部備註")
    @app_commands.autocomplete(case_id=_petition_autocomplete)
    async def petition_note(
        self, interaction: discord.Interaction, case_id: str, content: str
    ) -> None:
        if (
            await _command(interaction, "petition_note", {"case_id": case_id, "content": content})
            is not None
        ):
            await interaction.response.send_message("已新增內部備註。", ephemeral=True)

    @app_commands.command(name="petition_channel", description="建立陳情私密討論頻道")
    @app_commands.autocomplete(case_id=_petition_autocomplete)
    async def petition_channel(self, interaction: discord.Interaction, case_id: str) -> None:
        if await _command(interaction, "petition_channel", {"case_id": case_id}) is not None:
            await interaction.response.send_message("已排程建立私密頻道。", ephemeral=True)

    @app_commands.command(name="notify", description="設定 Discord DM 通知偏好")
    async def notify(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "notify_get")
        if data is not None:
            await interaction.response.send_message(
                embed=_preference_embed(data),
                view=NotifyView(data),
                ephemeral=True,
            )

    @app_commands.command(name="notify_status", description="查看 Discord 通知偏好")
    async def notify_status(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "notify_get")
        if data is not None:
            await interaction.response.send_message(embed=_preference_embed(data), ephemeral=True)

    @app_commands.command(name="notify_reset", description="把通知偏好還原為預設")
    async def notify_reset(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "notify_reset")
        if data is not None:
            await interaction.response.send_message(embed=_preference_embed(data), ephemeral=True)

    @app_commands.command(name="notify_quiet", description="設定免打擾時段")
    async def notify_quiet(
        self,
        interaction: discord.Interaction,
        start: str | None = None,
        end: str | None = None,
    ) -> None:
        if (start or end) and (
            not start or not end or not _QUIET_PATTERN.match(start) or not _QUIET_PATTERN.match(end)
        ):
            await interaction.response.send_message(
                "時間格式請用 HH:MM，例如 22:00 與 08:00。", ephemeral=True
            )
            return
        data = await _command(interaction, "notify_quiet", {"start": start, "end": end})
        if data is not None:
            await interaction.response.send_message(embed=_preference_embed(data), ephemeral=True)

    @app_commands.command(name="announce", description="開啟公告建立表單")
    async def announce(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(QuickCreateModal("announcement_create", "建立公告"))

    @app_commands.command(name="meeting_create", description="開啟會議建立表單")
    async def meeting_create(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(QuickCreateModal("meeting_create", "建立會議"))

    @app_commands.command(name="calendar_add", description="開啟行事曆建立表單")
    async def calendar_add(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(QuickCreateModal("calendar_create", "建立行事曆事件"))

    @app_commands.command(name="survey_quick", description="開啟問卷建立表單")
    async def survey_quick(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(QuickCreateModal("survey_create", "快速建立問卷"))


class SystemCog(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="system_status", description="查看系統狀態")
    async def system_status(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "system_status")
        if data is not None:
            await interaction.response.send_message(
                f"DB checked_out={data['db_checked_out']} "
                f"utilization={data['db_utilization']:.0%}\n"
                f"Redis={data['redis'].get('connected_clients') or data['redis'].get('error')}\n"
                f"Celery={data['celery'].get('error') or 'OK'}\n"
                f"Maintenance={data['maintenance'].get('enabled')} "
                f"load_shed={data['load_shed']}\n"
                f"Active requests={data['load']['active_requests']} "
                f"5xx={data['load']['recent_5xx_count']}",
                ephemeral=True,
            )

    @app_commands.command(name="defense_summary", description="查看防禦摘要")
    async def defense_summary(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "defense_summary")
        if data is not None:
            await interaction.response.send_message(
                "防禦摘要\n"
                f"active_rules={data['active_rule_count']} "
                f"total_rules={data['total_rule_count']}\n"
                f"status_counts={data['recent_status_counts']}",
                ephemeral=True,
            )

    @app_commands.command(name="server_info", description="查看伺服器摘要")
    async def server_info(self, interaction: discord.Interaction) -> None:
        guild = interaction.guild
        if guild is None:
            await interaction.response.send_message("請在伺服器內使用。", ephemeral=True)
            return
        await interaction.response.send_message(
            f"{guild.name}\nmembers={guild.member_count} roles={len(guild.roles)} "
            f"channels={len(guild.channels)}\nowner_id={guild.owner_id} "
            f"created_at={guild.created_at.date().isoformat()}",
            ephemeral=True,
        )

    @app_commands.command(name="user_info", description="查看成員摘要")
    async def user_info(
        self, interaction: discord.Interaction, member: discord.Member | None = None
    ) -> None:
        target = member or interaction.user
        if not isinstance(target, discord.Member):
            await interaction.response.send_message("請在伺服器內使用。", ephemeral=True)
            return
        data = await _command(interaction, "user_lookup", {"discord_user_id": str(target.id)})
        if data is None:
            return
        platform = (
            f"平台：{data['display_name']} / {data['email']}" if data["linked"] else "平台：未綁定"
        )
        roles = ", ".join(role.name for role in target.roles[-5:] if role.name != "@everyone")
        await interaction.response.send_message(
            f"{target} ({target.id})\n{platform}\n"
            f"joined_at={target.joined_at.date().isoformat() if target.joined_at else 'unknown'}\n"
            f"roles={roles or '無'}",
            ephemeral=True,
        )

    @app_commands.command(name="server_health", description="總覽平台與 Bot 健康狀態")
    async def server_health(self, interaction: discord.Interaction) -> None:
        data = await _command(interaction, "server_health")
        if data is None:
            return
        system = data["system"]
        embed = discord.Embed(title="HCCA 平台與 Bot 健康總覽")
        embed.add_field(name="Bot 延遲", value=f"{self.bot.latency * 1000:.0f} ms", inline=True)
        embed.add_field(
            name="DB pool",
            value=f"{system['db_checked_out']} / {system['db_utilization']:.0%}",
            inline=True,
        )
        embed.add_field(
            name="Defense rules",
            value=f"{data['defense']['active_rule_count']} / {data['defense']['total_rule_count']}",
            inline=True,
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="welcome_preview", description="預覽歡迎訊息")
    async def welcome_preview(self, interaction: discord.Interaction) -> None:
        if await _command(interaction, "server_health") is None:
            return
        embed = discord.Embed(
            title=f"歡迎 {interaction.user.display_name}",
            description=(
                f"<@{interaction.user.id}> 已加入伺服器。\n"
                "若已綁定平台帳號，身分組與暱稱會自動同步；"
                "尚未綁定者請至個人資料頁設定 Discord。"
            ),
            color=discord.Color.green(),
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="announce_pin", description="把訊息 pin 到本頻道")
    async def announce_pin(
        self,
        interaction: discord.Interaction,
        message_id: str,
        reason: str = "HCCA Discord 公告 pin",
    ) -> None:
        if not isinstance(interaction.channel, discord.TextChannel | discord.Thread):
            await interaction.response.send_message("此指令只能在文字頻道使用。", ephemeral=True)
            return
        if not await _moderation_audit(
            interaction,
            "discord.community.announce_pin",
            f"Discord pin 訊息 {message_id}",
            {"channel_id": str(interaction.channel_id), "message_id": message_id},
        ):
            return
        message = await interaction.channel.fetch_message(int(message_id))
        await message.pin(reason=reason)
        await interaction.response.send_message(f"已 pin 訊息 {message_id}。", ephemeral=True)


async def _moderation_audit(
    interaction: discord.Interaction,
    action: str,
    summary: str,
    meta: dict[str, Any],
) -> bool:
    return (
        await _command(
            interaction,
            "moderation_audit",
            {"action": action, "summary": summary, "meta": meta},
        )
        is not None
    )


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


async def load_commands(bot: commands.Bot) -> None:
    await bot.add_cog(PlatformCog(bot))
    await bot.add_cog(SystemCog(bot))
    await bot.add_cog(ModerationCog())
