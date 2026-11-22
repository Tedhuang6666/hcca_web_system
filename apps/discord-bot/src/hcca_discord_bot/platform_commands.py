"""平台一般 slash commands。"""

from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from hcca_discord_bot.command_common import (
    _QUIET_PATTERN,
    _command,
    _due_autocomplete,
    _parse_datetime,
    _petition_autocomplete,
    _work_item_autocomplete,
)
from hcca_discord_bot.command_views import (
    DocumentActionView,
    NotifyView,
    PetitionManageView,
    PetitionModal,
    QuickCreateModal,
    _preference_embed,
)


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
            "建立：/announce /survey_quick\n"
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

    @app_commands.command(name="survey_quick", description="開啟問卷建立表單")
    async def survey_quick(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(QuickCreateModal("survey_create", "快速建立問卷"))
