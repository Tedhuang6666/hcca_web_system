"""Discord Bot worker：HCCA 的 Discord 第二工作台。"""

from __future__ import annotations

import asyncio
import logging
import uuid

import discord
from discord import app_commands

from api.core.config import settings
from api.core.database import AsyncSessionLocal, engine
from api.core.load_signals import snapshot as load_snapshot
from api.core.maintenance import get_load_shed_force_mode, get_maintenance_state
from api.core.metrics import get_celery_stats, get_db_pool_stats, get_redis_stats
from api.models.document import DocumentStatus
from api.models.petition import PetitionStatus
from api.models.user import User
from api.routers.notifications import create_notification
from api.schemas.document import RejectMode
from api.schemas.petition import PetitionCreate, PetitionInternalNoteCreate, PetitionStatusUpdate
from api.services import audit as audit_svc
from api.services import defense as defense_svc
from api.services import document as doc_svc
from api.services import petition as petition_svc
from api.services.discord_bot import create_open_url, get_user_by_discord_id
from api.services.permission import get_user_permission_codes
from api.services.task_inbox import build_task_inbox

logger = logging.getLogger(__name__)


def _has(user: User, codes: frozenset[str], code: str) -> bool:
    return user.is_superuser or "admin:all" in codes or code in codes


async def _bound_user(interaction: discord.Interaction) -> User | None:
    async with AsyncSessionLocal() as db:
        return await get_user_by_discord_id(db, str(interaction.user.id))


async def _require_bound_user(interaction: discord.Interaction) -> User | None:
    user = await _bound_user(interaction)
    if user is None:
        await interaction.response.send_message(
            "請先到平台個人資料頁綁定 Discord，再使用辦公功能。", ephemeral=True
        )
        return None
    return user


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
        user = await _require_bound_user(interaction)
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
        user = await _require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not _has(user, codes, "document:reject"):
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
        user = await _require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not _has(user, codes, "document:approve"):
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
        user = await _require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not _has(user, codes, "petition:handle"):
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


class HccaDiscordClient(discord.Client):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        guild_id = settings.DISCORD_COMMAND_SYNC_GUILD_ID or settings.DISCORD_GUILD_ID
        if guild_id:
            guild = discord.Object(id=int(guild_id))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()


client = HccaDiscordClient()


@client.tree.command(name="me", description="查看平台綁定與待辦摘要")
async def me(interaction: discord.Interaction) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        inbox = await build_task_inbox(db, user)
        open_url = await create_open_url(user.id, "/dashboard")
    await interaction.response.send_message(
        f"{user.display_name}\n待辦：{inbox.total} 件\n{open_url}",
        ephemeral=True,
    )


@client.tree.command(name="tasks", description="列出平台待辦")
async def tasks(interaction: discord.Interaction) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        inbox = await build_task_inbox(db, user)
        if not inbox.items:
            await interaction.response.send_message("目前沒有待辦。", ephemeral=True)
            return
        lines = [f"待辦共 {inbox.total} 件："]
        for item in inbox.items[:8]:
            lines.append(f"- {item.title}：{await create_open_url(user.id, item.href)}")
    await interaction.response.send_message("\n".join(lines), ephemeral=True)


@client.tree.command(name="petition", description="用私密表單建立陳情")
async def petition(interaction: discord.Interaction) -> None:
    await interaction.response.send_modal(PetitionModal())


@client.tree.command(name="documents_pending", description="列出待你審核的公文")
async def documents_pending(interaction: discord.Interaction) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    await interaction.response.defer(ephemeral=True)
    async with AsyncSessionLocal() as db:
        inbox = await build_task_inbox(db, user)
        docs = [item for item in inbox.items if item.module == "document"][:5]
        if not docs:
            await interaction.followup.send("目前沒有待審公文。", ephemeral=True)
            return
        for item in docs:
            try:
                document_id = uuid.UUID(item.id.split(":")[1])
            except (IndexError, ValueError):
                continue
            await interaction.followup.send(
                f"{item.title}\n{item.subtitle or ''}",
                view=DocumentActionView(document_id, await create_open_url(user.id, item.href)),
                ephemeral=True,
            )


@client.tree.command(name="petitions_pending", description="列出陳情待辦")
async def petitions_pending(interaction: discord.Interaction) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    await interaction.response.defer(ephemeral=True)
    async with AsyncSessionLocal() as db:
        cases = await petition_svc.list_cases(db, assigned_to_id=user.id, limit=5)
        if not cases:
            await interaction.followup.send("目前沒有指派給你的陳情。", ephemeral=True)
            return
        for case_obj in cases:
            await interaction.followup.send(
                f"{case_obj.case_number}｜{case_obj.title}",
                view=PetitionManageView(
                    case_obj.id,
                    await create_open_url(user.id, f"/petitions/manage?case={case_obj.id}"),
                ),
                ephemeral=True,
            )


@client.tree.command(name="petition_note", description="新增陳情內部備註")
async def petition_note(interaction: discord.Interaction, case_id: str, content: str) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        codes = await get_user_permission_codes(db, user.id)
        if not _has(user, codes, "petition:handle"):
            await interaction.response.send_message("你沒有處理陳情權限。", ephemeral=True)
            return
        case_obj = await petition_svc.get_case(db, uuid.UUID(case_id))
        if case_obj is None:
            await interaction.response.send_message("找不到此陳情案件。", ephemeral=True)
            return
        await petition_svc.add_internal_note(
            db,
            case_obj,
            data=PetitionInternalNoteCreate(content=content),
            actor_id=user.id,
        )
        await audit_svc.record(
            db,
            entity_type="petition_case",
            entity_id=str(case_obj.id),
            action="discord.petition.note",
            actor_id=str(user.id),
            actor_email=user.email,
            meta={"discord_interaction_id": str(interaction.id)},
            summary=f"Discord 新增陳情案件 {case_obj.case_number} 內部備註",
        )
        await db.commit()
    await interaction.response.send_message("已新增內部備註。", ephemeral=True)


@client.tree.command(name="system_status", description="查看系統狀態")
async def system_status(interaction: discord.Interaction) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        codes = await get_user_permission_codes(db, user.id)
    if not _has(user, codes, "admin:all"):
        await interaction.response.send_message("你沒有系統管理權限。", ephemeral=True)
        return
    db_pool = get_db_pool_stats(engine)
    redis = await get_redis_stats()
    celery = await get_celery_stats()
    maintenance = await get_maintenance_state()
    load = load_snapshot()
    text = (
        f"DB checked_out={db_pool.checked_out} utilization={db_pool.utilization:.0%}\n"
        f"Redis clients={redis.get('connected_clients')} error={redis.get('error')}\n"
        f"Celery error={celery.get('error')}\n"
        f"Maintenance={maintenance.get('enabled')} load_shed={await get_load_shed_force_mode()}\n"
        f"Active requests={load['active_requests']} 5xx={load['recent_5xx_count']}"
    )
    await interaction.response.send_message(text, ephemeral=True)


@client.tree.command(name="defense_summary", description="查看防禦摘要")
async def defense_summary(interaction: discord.Interaction) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        codes = await get_user_permission_codes(db, user.id)
        if not _has(user, codes, "admin:all"):
            await interaction.response.send_message("你沒有系統管理權限。", ephemeral=True)
            return
        data = await defense_svc.summary(db)
    await interaction.response.send_message(
        "防禦摘要\n"
        f"active_rules={data['active_rule_count']} total_rules={data['total_rule_count']}\n"
        f"status_counts={data['recent_status_counts']}",
        ephemeral=True,
    )


async def main() -> None:
    if not settings.DISCORD_BOT_TOKEN:
        raise RuntimeError("DISCORD_BOT_TOKEN 未設定")
    await client.start(settings.DISCORD_BOT_TOKEN)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
