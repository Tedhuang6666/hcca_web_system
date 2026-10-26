"""Discord 文件、陳情與通知互動元件。"""

from __future__ import annotations

from typing import Any

import discord

from hcca_discord_bot.command_common import _CATEGORY_LABEL, _command


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

    def __init__(self, operation: str, title: str) -> None:
        super().__init__(title=title)
        self.operation = operation

    async def on_submit(self, interaction: discord.Interaction) -> None:
        title = str(self.title_input.value)
        detail = str(self.detail_input.value) or None
        extra = str(self.extra_input.value) or None
        arguments: dict[str, Any] = {"title": title}
        if self.operation == "announcement_create":
            arguments.update(
                body=detail or "",
                is_urgent=(extra or "").lower() in {"yes", "y", "1", "緊急"},
            )
        else:
            arguments.update(
                description=detail,
                is_anonymous=(extra or "").lower() in {"yes", "y", "1", "匿名"},
            )
        data = await _command(interaction, self.operation, arguments)
        if data is not None:
            await interaction.response.send_message(f"已建立「{data['title']}」。", ephemeral=True)
