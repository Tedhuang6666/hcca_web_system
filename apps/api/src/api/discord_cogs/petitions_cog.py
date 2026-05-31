"""陳情 cog：/petition /petitions_pending /petition_note /petition_channel。"""

from __future__ import annotations

import uuid

import discord
from discord import app_commands
from discord.ext import commands

from api.core.database import AsyncSessionLocal
from api.discord_cogs._helpers import has_permission, require_bound_user
from api.discord_cogs._views import PetitionManageView, PetitionModal
from api.schemas.petition import PetitionInternalNoteCreate
from api.services import audit as audit_svc
from api.services import petition as petition_svc
from api.services.discord_bot import create_open_url, enqueue_petition_private_channel
from api.services.permission import get_user_permission_codes


class PetitionsCog(commands.Cog):
    """陳情建立、處理、私密頻道。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="petition", description="用私密表單建立陳情")
    async def petition(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(PetitionModal())

    @app_commands.command(name="petitions_pending", description="列出陳情待辦")
    async def petitions_pending(self, interaction: discord.Interaction) -> None:
        user = await require_bound_user(interaction)
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

    @app_commands.command(name="petition_note", description="新增陳情內部備註")
    async def petition_note(
        self, interaction: discord.Interaction, case_id: str, content: str
    ) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not has_permission(user, codes, "petition:handle"):
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

    @app_commands.command(name="petition_channel", description="為陳情案件建立私密討論頻道")
    async def petition_channel(self, interaction: discord.Interaction, case_id: str) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            codes = await get_user_permission_codes(db, user.id)
            if not has_permission(user, codes, "petition:handle"):
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
                await interaction.response.send_message(
                    "此案件已有頻道，或後台尚未完成頻道設定。", ephemeral=True
                )
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
