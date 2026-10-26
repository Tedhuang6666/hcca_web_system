"""Discord 指令領域 handler。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus
from api.schemas.work_item import WorkItemCreate
from api.services import work_item as work_item_svc
from api.services.discord_bot import (
    get_user_by_discord_id,
)
from api.services.discord_command_common import (
    DiscordCommandError,
    _audit,
)


async def handle(
    db: AsyncSession,
    user: User,
    codes: frozenset[str],
    *,
    operation: str,
    discord_user_id: str,
    interaction_id: str,
    guild_id: str | None,
    arguments: dict[str, Any],
) -> dict[str, Any] | None:
    if operation == "assign_task":
        assignee = await get_user_by_discord_id(db, str(arguments["assignee_discord_user_id"]))
        if assignee is None:
            raise DiscordCommandError("對方尚未綁定平台帳號。")
        due_at = arguments.get("due_at")
        item = await work_item_svc.create_work_item(
            db,
            data=WorkItemCreate(
                title=str(arguments["title"]),
                description=arguments.get("description"),
                assigned_to_id=assignee.id,
                due_at=datetime.fromisoformat(due_at) if due_at else None,
                source_type="discord",
            ),
            created_by_id=user.id,
        )
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="work_item",
            entity_id=str(item.id),
            action="discord.work_item.create",
            summary=f"Discord 指派工作：{item.title}",
            meta={"assignee": str(arguments["assignee_discord_user_id"])},
        )
        return {"id": str(item.id), "title": item.title}
    if operation == "complete_task":
        try:
            item = await work_item_svc.get_work_item(db, uuid.UUID(str(arguments["task_id"])))
        except ValueError:
            item = None
        if item is None or item.assigned_to_id != user.id:
            raise DiscordCommandError("找不到可由你完成的工作。")
        await work_item_svc.complete_work_item(db, item=item)
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="work_item",
            entity_id=str(item.id),
            action="discord.work_item.complete",
            summary=f"Discord 完成工作：{item.title}",
        )
        return {"title": item.title}
    if operation == "work_item_choices":
        rows = (
            await db.execute(
                select(WorkItem)
                .where(
                    WorkItem.assigned_to_id == user.id,
                    WorkItem.status != WorkItemStatus.DONE,
                )
                .order_by(WorkItem.created_at.desc())
                .limit(25)
            )
        ).scalars()
        return {"items": [{"id": str(row.id), "title": row.title} for row in rows]}
    return None
