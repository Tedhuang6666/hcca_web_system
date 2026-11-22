"""治理事項 Discord 工作區與事件路由。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import case, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.governance import (
    GovernanceDiscordEventRoute,
    GovernanceDiscordWorkspace,
)
from api.services.outbox import emit


async def get_workspace(
    db: AsyncSession, matter_id: uuid.UUID
) -> GovernanceDiscordWorkspace | None:
    return await db.scalar(
        select(GovernanceDiscordWorkspace)
        .options(selectinload(GovernanceDiscordWorkspace.routes))
        .where(GovernanceDiscordWorkspace.matter_id == matter_id)
    )


async def apply_workspace_result(
    db: AsyncSession,
    workspace_id: str,
    *,
    success: bool,
    error: str | None,
    result: dict,
) -> None:
    try:
        parsed_id = uuid.UUID(workspace_id)
    except ValueError:
        return
    workspace = await db.get(GovernanceDiscordWorkspace, parsed_id)
    if workspace is None:
        return
    if not success:
        workspace.sync_status = "failed"
        workspace.last_error = (error or "Discord 工作區同步失敗")[:2000]
        return
    for field in (
        "category_id",
        "discussion_channel_id",
        "announcement_channel_id",
        "staff_channel_id",
    ):
        setattr(workspace, field, result.get(field) or getattr(workspace, field))
    workspace.sync_status = "synced"
    workspace.last_error = None
    workspace.last_synced_at = datetime.now(UTC)


async def emit_matter_event(
    db: AsyncSession,
    *,
    matter_id: uuid.UUID,
    event_type: str,
    title: str,
    body: str | None,
    href: str | None,
) -> None:
    workspace = await get_workspace(db, matter_id)
    if workspace is None or not workspace.is_active:
        return
    module_route = f"{event_type.split('.', 1)[0]}.*"
    route = await db.scalar(
        select(GovernanceDiscordEventRoute)
        .where(
            GovernanceDiscordEventRoute.workspace_id == workspace.id,
            or_(
                GovernanceDiscordEventRoute.event_type == event_type,
                GovernanceDiscordEventRoute.event_type == module_route,
            ),
            GovernanceDiscordEventRoute.is_active.is_(True),
        )
        .order_by(case((GovernanceDiscordEventRoute.event_type == event_type, 0), else_=1))
    )
    if route is None:
        return
    channel_id = route.channel_id
    if not channel_id:
        channel_id = {
            "discussion": workspace.discussion_channel_id,
            "announcement": workspace.announcement_channel_id,
            "staff": workspace.staff_channel_id,
        }.get(route.channel_kind)
    if not channel_id:
        return
    mention = f"<@&{route.mention_role_id}> " if route.mention_role_id else ""
    await emit(
        db,
        event_type="discord.channel_alert",
        payload={
            "channel_id": channel_id,
            "title": title,
            "body": f"{mention}{body or ''}".strip() or None,
            "link": href,
            "thread_name": title[:80] if route.create_thread else None,
        },
    )


__all__ = ["apply_workspace_result", "emit_matter_event", "get_workspace"]
