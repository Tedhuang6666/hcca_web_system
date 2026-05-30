"""Discord Bot worker：HCCA 的 Discord 第二工作台。"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

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
from api.schemas.work_item import WorkItemCreate
from api.services import audit as audit_svc
from api.services import defense as defense_svc
from api.services import document as doc_svc
from api.services import petition as petition_svc
from api.services import work_item as work_item_svc
from api.services.discord_bot import (
    create_open_url,
    emit_moderation_log,
    emit_public_document_notice,
    emit_welcome_message,
    enqueue_all_role_sync,
    enqueue_petition_private_channel,
    enqueue_role_sync,
    get_user_by_discord_id,
)
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


async def _require_platform_admin(interaction: discord.Interaction) -> User | None:
    user = await _require_bound_user(interaction)
    if user is None:
        return None
    async with AsyncSessionLocal() as db:
        codes = await get_user_permission_codes(db, user.id)
    if not _has(user, codes, "admin:all"):
        await interaction.response.send_message("你沒有 Discord 社群管理權限。", ephemeral=True)
        return None
    return user


async def _audit_discord_action(
    actor: User,
    interaction: discord.Interaction,
    *,
    action: str,
    summary: str,
    meta: dict,
) -> None:
    async with AsyncSessionLocal() as db:
        await audit_svc.record(
            db,
            entity_type="discord_guild",
            entity_id=str(interaction.guild_id or "dm"),
            action=action,
            actor_id=str(actor.id),
            actor_email=actor.email,
            meta={**meta, "discord_interaction_id": str(interaction.id)},
            summary=summary,
        )
        await emit_moderation_log(
            db,
            guild_id=str(interaction.guild_id) if interaction.guild_id else None,
            title=summary,
            body="\n".join(f"{key}: {value}" for key, value in meta.items()),
        )
        await db.commit()


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
        intents.members = True
        intents.moderation = True
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

    async def on_member_join(self, member: discord.Member) -> None:
        async with AsyncSessionLocal() as db:
            user = await get_user_by_discord_id(db, str(member.id))
            if user is not None:
                await enqueue_role_sync(db, user.id)
                await emit_moderation_log(
                    db,
                    guild_id=str(member.guild.id),
                    title="Discord 成員加入並已綁定平台",
                    body=f"{member} / {user.display_name}",
                )
            await emit_welcome_message(
                db,
                guild_id=str(member.guild.id),
                discord_user_id=str(member.id),
                display_name=member.display_name,
            )
            await db.commit()


client = HccaDiscordClient()


@client.tree.command(name="ping", description="確認 HCCA Bot 狀態")
async def ping(interaction: discord.Interaction) -> None:
    await interaction.response.send_message(
        f"HCCA Bot online. latency={client.latency * 1000:.0f}ms",
        ephemeral=True,
    )


@client.tree.command(name="hcca_help", description="查看 HCCA Bot 功能摘要")
async def hcca_help(interaction: discord.Interaction) -> None:
    text = (
        "HCCA Bot\n"
        "個人：/me /tasks /sync_me\n"
        "工作：/assign_task /complete_task\n"
        "公文陳情：/documents_pending /petition /petitions_pending /petition_note /petition_channel\n"
        "系統：/system_status /defense_summary\n"
        "社群管理：admin:all 可用 /purge /timeout /untimeout /kick /ban /unban /slowmode /lock /unlock"
    )
    await interaction.response.send_message(text, ephemeral=True)


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


@client.tree.command(name="assign_task", description="指派工作與期限提醒")
async def assign_task(
    interaction: discord.Interaction,
    member: discord.Member,
    title: str,
    due_at: str | None = None,
    description: str | None = None,
) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        assignee = await get_user_by_discord_id(db, str(member.id))
        if assignee is None:
            await interaction.response.send_message("對方尚未綁定平台帳號。", ephemeral=True)
            return
        due = None
        if due_at:
            try:
                due = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
                if due.tzinfo is None:
                    due = due.replace(tzinfo=UTC)
            except ValueError:
                await interaction.response.send_message(
                    "期限格式請用 ISO，例如 2026-05-30T18:00:00+08:00。", ephemeral=True
                )
                return
        item = await work_item_svc.create_work_item(
            db,
            data=WorkItemCreate(
                title=title,
                description=description,
                assigned_to_id=assignee.id,
                due_at=due,
                source_type="discord",
            ),
            created_by_id=user.id,
        )
        await audit_svc.record(
            db,
            entity_type="work_item",
            entity_id=str(item.id),
            action="discord.work_item.create",
            actor_id=str(user.id),
            actor_email=user.email,
            meta={"discord_interaction_id": str(interaction.id), "assignee": str(member.id)},
            summary=f"Discord 指派工作：{item.title}",
        )
        await db.commit()
    await interaction.response.send_message(f"已指派給 {member.mention}：{item.title}", ephemeral=True)


@client.tree.command(name="complete_task", description="完成一筆工作分配")
async def complete_task(interaction: discord.Interaction, task_id: str) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        try:
            item = await work_item_svc.get_work_item(db, uuid.UUID(task_id))
        except ValueError:
            item = None
        if item is None or item.assigned_to_id != user.id:
            await interaction.response.send_message("找不到可由你完成的工作。", ephemeral=True)
            return
        await work_item_svc.complete_work_item(db, item=item)
        await audit_svc.record(
            db,
            entity_type="work_item",
            entity_id=str(item.id),
            action="discord.work_item.complete",
            actor_id=str(user.id),
            actor_email=user.email,
            meta={"discord_interaction_id": str(interaction.id)},
            summary=f"Discord 完成工作：{item.title}",
        )
        await db.commit()
    await interaction.response.send_message(f"已完成：{item.title}", ephemeral=True)


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


@client.tree.command(name="petition_channel", description="為陳情案件建立私密討論頻道")
async def petition_channel(interaction: discord.Interaction, case_id: str) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        codes = await get_user_permission_codes(db, user.id)
        if not _has(user, codes, "petition:handle"):
            await interaction.response.send_message("你沒有處理陳情權限。", ephemeral=True)
            return
        try:
            case_obj = await petition_svc.get_case(db, uuid.UUID(case_id))
        except ValueError:
            case_obj = None
        if case_obj is None:
            await interaction.response.send_message("找不到此陳情案件。", ephemeral=True)
            return
        queued = await enqueue_petition_private_channel(db, case_obj, force=True)
        if not queued:
            await interaction.response.send_message("此案件已有頻道，或後台尚未完成頻道設定。", ephemeral=True)
            return
        await audit_svc.record(
            db,
            entity_type="petition_case",
            entity_id=str(case_obj.id),
            action="discord.petition.channel",
            actor_id=str(user.id),
            actor_email=user.email,
            meta={"discord_interaction_id": str(interaction.id)},
            summary=f"Discord 建立陳情私密頻道 {case_obj.case_number}",
        )
        await db.commit()
    await interaction.response.send_message("已排程建立私密討論頻道。", ephemeral=True)


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


@client.tree.command(name="sync_me", description="同步自己的平台身分組與社群暱稱前綴")
async def sync_me(interaction: discord.Interaction) -> None:
    user = await _require_bound_user(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        await enqueue_role_sync(db, user.id)
        await db.commit()
    await interaction.response.send_message("已排程同步你的身分組與暱稱前綴。", ephemeral=True)


@client.tree.command(name="sync_all", description="排程同步所有已綁定成員")
async def sync_all(interaction: discord.Interaction) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    async with AsyncSessionLocal() as db:
        queued = await enqueue_all_role_sync(db)
        await audit_svc.record(
            db,
            entity_type="discord_account_link",
            entity_id="all",
            action="discord.sync_all",
            actor_id=str(user.id),
            actor_email=user.email,
            meta={"discord_interaction_id": str(interaction.id), "queued": queued},
            summary="Discord 排程同步所有已綁定成員",
        )
        await emit_moderation_log(
            db,
            guild_id=str(interaction.guild_id) if interaction.guild_id else None,
            title="Discord 排程同步所有已綁定成員",
            body=f"queued: {queued}",
        )
        await db.commit()
    await interaction.response.send_message(f"已排程同步 {queued} 位已綁定成員。", ephemeral=True)


@client.tree.command(name="server_info", description="查看伺服器摘要")
async def server_info(interaction: discord.Interaction) -> None:
    if interaction.guild is None:
        await interaction.response.send_message("此指令只能在伺服器內使用。", ephemeral=True)
        return
    guild = interaction.guild
    text = (
        f"{guild.name}\n"
        f"members={guild.member_count} roles={len(guild.roles)} channels={len(guild.channels)}\n"
        f"owner_id={guild.owner_id} created_at={guild.created_at.date().isoformat()}"
    )
    await interaction.response.send_message(text, ephemeral=True)


@client.tree.command(name="user_info", description="查看成員摘要")
async def user_info(interaction: discord.Interaction, member: discord.Member | None = None) -> None:
    target = member or interaction.user
    if not isinstance(target, discord.Member):
        await interaction.response.send_message("請在伺服器內使用。", ephemeral=True)
        return
    async with AsyncSessionLocal() as db:
        user = await get_user_by_discord_id(db, str(target.id))
    platform = f"平台：{user.display_name} / {user.email}" if user else "平台：未綁定"
    roles = ", ".join(role.name for role in target.roles[-5:] if role.name != "@everyone") or "無"
    text = (
        f"{target} ({target.id})\n"
        f"{platform}\n"
        f"joined_at={target.joined_at.date().isoformat() if target.joined_at else 'unknown'}\n"
        f"roles={roles}"
    )
    await interaction.response.send_message(text, ephemeral=True)


@client.tree.command(name="purge", description="清除本頻道最近訊息")
async def purge(interaction: discord.Interaction, amount: app_commands.Range[int, 1, 100]) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    if not isinstance(interaction.channel, discord.TextChannel | discord.Thread):
        await interaction.response.send_message("此指令只能在文字頻道使用。", ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True)
    deleted = await interaction.channel.purge(limit=int(amount))
    await _audit_discord_action(
        user,
        interaction,
        action="discord.community.purge",
        summary=f"Discord 清除 {len(deleted)} 則訊息",
        meta={"channel_id": str(interaction.channel_id), "amount": amount},
    )
    await interaction.followup.send(f"已清除 {len(deleted)} 則訊息。", ephemeral=True)


@client.tree.command(name="timeout", description="將成員暫時禁言")
async def timeout_member(
    interaction: discord.Interaction,
    member: discord.Member,
    minutes: app_commands.Range[int, 1, 10080],
    reason: str = "Discord 管理指令",
) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    await member.timeout(discord.utils.utcnow() + timedelta(minutes=int(minutes)), reason=reason)
    await _audit_discord_action(
        user,
        interaction,
        action="discord.community.timeout",
        summary=f"Discord 禁言 {member}",
        meta={"target_id": str(member.id), "minutes": minutes, "reason": reason},
    )
    await interaction.response.send_message(
        f"已禁言 {member.mention} {minutes} 分鐘。", ephemeral=True
    )


@client.tree.command(name="untimeout", description="解除成員禁言")
async def untimeout_member(
    interaction: discord.Interaction, member: discord.Member, reason: str = "Discord 管理指令"
) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    await member.timeout(None, reason=reason)
    await _audit_discord_action(
        user,
        interaction,
        action="discord.community.untimeout",
        summary=f"Discord 解除禁言 {member}",
        meta={"target_id": str(member.id), "reason": reason},
    )
    await interaction.response.send_message(f"已解除 {member.mention} 的禁言。", ephemeral=True)


@client.tree.command(name="kick", description="踢出成員")
async def kick_member(
    interaction: discord.Interaction, member: discord.Member, reason: str = "Discord 管理指令"
) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    await member.kick(reason=reason)
    await _audit_discord_action(
        user,
        interaction,
        action="discord.community.kick",
        summary=f"Discord 踢出 {member}",
        meta={"target_id": str(member.id), "reason": reason},
    )
    await interaction.response.send_message(f"已踢出 {member}。", ephemeral=True)


@client.tree.command(name="ban", description="封鎖成員")
async def ban_member(
    interaction: discord.Interaction,
    member: discord.Member,
    delete_message_days: app_commands.Range[int, 0, 7] = 0,
    reason: str = "Discord 管理指令",
) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    await member.ban(delete_message_days=int(delete_message_days), reason=reason)
    await _audit_discord_action(
        user,
        interaction,
        action="discord.community.ban",
        summary=f"Discord 封鎖 {member}",
        meta={
            "target_id": str(member.id),
            "delete_message_days": delete_message_days,
            "reason": reason,
        },
    )
    await interaction.response.send_message(f"已封鎖 {member}。", ephemeral=True)


@client.tree.command(name="unban", description="用 Discord User ID 解除封鎖")
async def unban_member(
    interaction: discord.Interaction, user_id: str, reason: str = "Discord 管理指令"
) -> None:
    actor = await _require_platform_admin(interaction)
    if actor is None:
        return
    if interaction.guild is None:
        await interaction.response.send_message("此指令只能在伺服器內使用。", ephemeral=True)
        return
    target = discord.Object(id=int(user_id))
    await interaction.guild.unban(target, reason=reason)
    await _audit_discord_action(
        actor,
        interaction,
        action="discord.community.unban",
        summary=f"Discord 解除封鎖 {user_id}",
        meta={"target_id": user_id, "reason": reason},
    )
    await interaction.response.send_message(f"已解除封鎖 {user_id}。", ephemeral=True)


@client.tree.command(name="slowmode", description="設定本頻道慢速模式秒數")
async def slowmode(
    interaction: discord.Interaction,
    seconds: app_commands.Range[int, 0, 21600],
    channel: discord.TextChannel | None = None,
) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    target = channel or interaction.channel
    if not isinstance(target, discord.TextChannel):
        await interaction.response.send_message("請指定文字頻道。", ephemeral=True)
        return
    await target.edit(slowmode_delay=int(seconds), reason="HCCA Discord 管理指令")
    await _audit_discord_action(
        user,
        interaction,
        action="discord.community.slowmode",
        summary=f"Discord 設定慢速模式 {seconds}s",
        meta={"channel_id": str(target.id), "seconds": seconds},
    )
    await interaction.response.send_message(
        f"已設定 {target.mention} 慢速模式 {seconds} 秒。", ephemeral=True
    )


@client.tree.command(name="lock", description="鎖定本頻道，禁止 @everyone 發言")
async def lock_channel(
    interaction: discord.Interaction, channel: discord.TextChannel | None = None
) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    target = channel or interaction.channel
    if not isinstance(target, discord.TextChannel) or interaction.guild is None:
        await interaction.response.send_message("請指定文字頻道。", ephemeral=True)
        return
    await target.set_permissions(
        interaction.guild.default_role,
        send_messages=False,
        reason="HCCA Discord 管理指令",
    )
    await _audit_discord_action(
        user,
        interaction,
        action="discord.community.lock",
        summary=f"Discord 鎖定頻道 {target}",
        meta={"channel_id": str(target.id)},
    )
    await interaction.response.send_message(f"已鎖定 {target.mention}。", ephemeral=True)


@client.tree.command(name="unlock", description="解除本頻道 @everyone 發言覆寫")
async def unlock_channel(
    interaction: discord.Interaction, channel: discord.TextChannel | None = None
) -> None:
    user = await _require_platform_admin(interaction)
    if user is None:
        return
    target = channel or interaction.channel
    if not isinstance(target, discord.TextChannel) or interaction.guild is None:
        await interaction.response.send_message("請指定文字頻道。", ephemeral=True)
        return
    await target.set_permissions(
        interaction.guild.default_role,
        send_messages=None,
        reason="HCCA Discord 管理指令",
    )
    await _audit_discord_action(
        user,
        interaction,
        action="discord.community.unlock",
        summary=f"Discord 解鎖頻道 {target}",
        meta={"channel_id": str(target.id)},
    )
    await interaction.response.send_message(f"已解除 {target.mention} 的發言鎖定。", ephemeral=True)


async def main() -> None:
    if not settings.DISCORD_BOT_TOKEN:
        raise RuntimeError("DISCORD_BOT_TOKEN 未設定")
    await client.start(settings.DISCORD_BOT_TOKEN)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
