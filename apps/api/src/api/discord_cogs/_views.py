"""Discord 互動元件：modals 與 button views（跨多個 cog 共用）。"""

from __future__ import annotations

import uuid

import discord

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import has_permission, require_bound_user
from api.models.document import DocumentStatus
from api.models.petition import PetitionStatus
from api.routers.notifications import create_notification
from api.schemas.document import RejectMode
from api.schemas.petition import PetitionCreate, PetitionStatusUpdate
from api.services import audit as audit_svc
from api.services import document as doc_svc
from api.services import petition as petition_svc
from api.services.discord_bot import emit_public_document_notice, enqueue_petition_private_channel
from api.services.permission import get_user_permission_codes


class PetitionModal(discord.ui.Modal, title="建立陳情"):
    title_input = discord.ui.TextInput(label="標題", max_length=200)
    content_input = discord.ui.TextInput(
        label="內容", style=discord.TextStyle.paragraph, max_length=4000
    )
    anonymous_input = discord.ui.TextInput(
        label="匿名送件？輸入 yes 或 no",
        default="yes",
        max_length=10,
        required=True,
    )

    async def on_submit(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            types = await petition_svc.list_types(db, active_only=True)
            if not types:
                await interaction.response.send_message("目前沒有可用的陳情類型。", ephemeral=True)
                return
            is_anonymous = self.anonymous_input.value.strip().lower() in {
                "yes",
                "y",
                "true",
                "1",
                "匿名",
            }
            case_obj, code = await petition_svc.create_case(
                db,
                data=PetitionCreate(
                    type_id=types[0].id,
                    is_named=not is_anonymous,
                    contact_name=None if is_anonymous else user.display_name,
                    contact_email=None if is_anonymous else user.email,
                    title=str(self.title_input.value),
                    content=str(self.content_input.value),
                ),
                submitter=user,
            )
            await audit_svc.record(
                db,
                entity_type="petition_case",
                entity_id=str(case_obj.id),
                action="discord.petition.create",
                actor_id=str(user.id),
                actor_email=user.email,
                meta={
                    "discord_interaction_id": str(interaction.id),
                    "case_number": case_obj.case_number,
                    "is_anonymous": is_anonymous,
                },
                summary=f"Discord 建立陳情案件 {case_obj.case_number}",
            )
            await enqueue_petition_private_channel(db, case_obj)
            await db.commit()
        await interaction.response.send_message(
            f"已建立陳情案件 {case_obj.case_number}。查詢驗證碼：{code}", ephemeral=True
        )


class RejectDocumentModal(discord.ui.Modal, title="退回公文"):
    comment = discord.ui.TextInput(
        label="退件理由", style=discord.TextStyle.paragraph, max_length=1000
    )

    def __init__(self, document_id: uuid.UUID, mode: RejectMode) -> None:
        super().__init__()
        self.document_id = document_id
        self.mode = mode

    async def on_submit(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not has_permission(user, codes, "document:reject"):
                await interaction.response.send_message("你沒有退回公文權限。", ephemeral=True)
                return
            doc = await doc_svc.get_document(db, self.document_id)
            if doc is None:
                await interaction.response.send_message("找不到此公文。", ephemeral=True)
                return
            try:
                if self.mode == RejectMode.TO_PREVIOUS:
                    updated = await doc_svc.reject_to_previous_step(
                        db, doc, approver_id=user.id, comment=str(self.comment.value)
                    )
                else:
                    updated = await doc_svc.reject_step(
                        db, doc, approver_id=user.id, comment=str(self.comment.value)
                    )
            except (PermissionError, ValueError) as exc:
                await interaction.response.send_message(str(exc), ephemeral=True)
                return
            await audit_svc.record(
                db,
                entity_type="document",
                entity_id=str(updated.id),
                action="discord.document.reject",
                actor_id=str(user.id),
                actor_email=user.email,
                meta={"mode": self.mode, "discord_interaction_id": str(interaction.id)},
                summary=f"Discord 退回公文「{updated.title}」",
            )
            await db.commit()
        await interaction.response.send_message(f"已退回：{updated.title}", ephemeral=True)


class DocumentActionView(discord.ui.View):
    def __init__(self, document_id: uuid.UUID, open_url: str) -> None:
        super().__init__(timeout=300)
        self.document_id = document_id
        self.add_item(discord.ui.Button(label="查看全文", url=open_url))

    @discord.ui.button(label="核准", style=discord.ButtonStyle.success)
    async def approve(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not has_permission(user, codes, "document:approve"):
                await interaction.response.send_message("你沒有核准公文權限。", ephemeral=True)
                return
            doc = await doc_svc.get_document(db, self.document_id)
            if doc is None:
                await interaction.response.send_message("找不到此公文。", ephemeral=True)
                return
            try:
                updated = await doc_svc.approve_step(
                    db, doc, approver_id=user.id, comment="Discord 核准"
                )
            except (PermissionError, ValueError) as exc:
                await interaction.response.send_message(str(exc), ephemeral=True)
                return
            await audit_svc.record(
                db,
                entity_type="document",
                entity_id=str(updated.id),
                action="discord.document.approve",
                actor_id=str(user.id),
                actor_email=user.email,
                meta={"discord_interaction_id": str(interaction.id)},
                summary=f"Discord 核准公文「{updated.title}」",
            )
            if updated.status == DocumentStatus.APPROVED:
                await create_notification(
                    db,
                    user_id=updated.created_by,
                    type="document_approved",
                    title=f"公文已核准：{updated.title}",
                    body=f"字號：{updated.serial_number}",
                    link=f"/documents/{updated.id}",
                    related_id=updated.id,
                )
                await emit_public_document_notice(db, updated)
            await db.commit()
        await interaction.response.send_message(f"已核准：{updated.title}", ephemeral=True)

    @discord.ui.button(label="退回承辦人", style=discord.ButtonStyle.danger)
    async def reject_creator(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_modal(
            RejectDocumentModal(self.document_id, RejectMode.TO_CREATOR)
        )

    @discord.ui.button(label="退回上一關", style=discord.ButtonStyle.secondary)
    async def reject_previous(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_modal(
            RejectDocumentModal(self.document_id, RejectMode.TO_PREVIOUS)
        )


class PetitionManageView(discord.ui.View):
    def __init__(self, case_id: uuid.UUID, open_url: str) -> None:
        super().__init__(timeout=300)
        self.case_id = case_id
        self.add_item(discord.ui.Button(label="開啟案件", url=open_url))

    @discord.ui.button(label="標記處理中", style=discord.ButtonStyle.primary)
    async def mark_in_progress(
        self, interaction: discord.Interaction, _: discord.ui.Button
    ) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not has_permission(user, codes, "petition:handle"):
                await interaction.response.send_message("你沒有處理陳情權限。", ephemeral=True)
                return
            case_obj = await petition_svc.get_case(db, self.case_id)
            if case_obj is None:
                await interaction.response.send_message("找不到此陳情案件。", ephemeral=True)
                return
            case_obj = await petition_svc.update_status(
                db,
                case_obj,
                data=PetitionStatusUpdate(
                    status=PetitionStatus.IN_PROGRESS, internal_note="Discord 標記處理中"
                ),
                actor_id=user.id,
            )
            await audit_svc.record(
                db,
                entity_type="petition_case",
                entity_id=str(case_obj.id),
                action="discord.petition.status",
                actor_id=str(user.id),
                actor_email=user.email,
                meta={
                    "status": PetitionStatus.IN_PROGRESS.value,
                    "discord_interaction_id": str(interaction.id),
                },
                summary=f"Discord 更新陳情案件 {case_obj.case_number} 狀態",
            )
            await db.commit()
        await interaction.response.send_message(
            f"已更新案件 {case_obj.case_number}。", ephemeral=True
        )

    @discord.ui.button(label="新增內部備註", style=discord.ButtonStyle.secondary)
    async def note_hint(self, interaction: discord.Interaction, _: discord.ui.Button) -> None:
        await interaction.response.send_message(
            "內部備註請用 `/petition_note case_id:<UUID> content:<內容>`，或開啟案件進入平台編輯。",
            ephemeral=True,
        )


__all__ = [
    "DocumentActionView",
    "PetitionManageView",
    "PetitionModal",
    "RejectDocumentModal",
]
