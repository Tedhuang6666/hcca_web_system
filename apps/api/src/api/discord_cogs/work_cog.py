"""工作分配 cog：/assign_task /complete_task。"""

from __future__ import annotations

import uuid

import discord
from discord import app_commands
from discord.ext import commands

from api.core.database import AsyncSessionLocal
from api.discord_cogs._autocomplete import (
    due_at_autocomplete,
    my_work_item_autocomplete,
    parse_due_at,
)
from api.discord_cogs._helpers import require_bound_user
from api.schemas.work_item import WorkItemCreate
from api.services import audit as audit_svc
from api.services import work_item as work_item_svc
from api.services.discord_bot import get_user_by_discord_id


class WorkCog(commands.Cog):
    """工作分配與完成指令。"""

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="assign_task", description="指派工作與期限提醒")
    @app_commands.autocomplete(due_at=due_at_autocomplete)
    async def assign_task(
        self,
        interaction: discord.Interaction,
        member: discord.Member,
        title: str,
        due_at: str | None = None,
        description: str | None = None,
    ) -> None:
        user = await require_bound_user(interaction)
        if user is None:
            return
        async with AsyncSessionLocal() as db:
            assignee = await get_user_by_discord_id(db, str(member.id))
            if assignee is None:
                await interaction.response.send_message("對方尚未綁定平台帳號。", ephemeral=True)
                return
            due = parse_due_at(due_at)
            if due_at and due is None:
                await interaction.response.send_message(
                    "期限格式不接受。可用 autocomplete 預設選項，或輸入 ISO 例 2026-05-30T18:00:00+08:00。",
                    ephemeral=True,
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
        await interaction.response.send_message(
            f"已指派給 {member.mention}：{item.title}", ephemeral=True
        )

    @app_commands.command(name="complete_task", description="完成一筆工作分配")
    @app_commands.autocomplete(task_id=my_work_item_autocomplete)
    async def complete_task(self, interaction: discord.Interaction, task_id: str) -> None:
        user = await require_bound_user(interaction)
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
