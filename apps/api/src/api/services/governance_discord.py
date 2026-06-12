"""治理事項 Discord 工作區與事件路由。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import case, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.discord_account import DiscordRolePolicy
from api.models.governance import (
    GovernanceDiscordEventRoute,
    GovernanceDiscordWorkspace,
    Matter,
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


async def upsert_workspace(
    db: AsyncSession, matter: Matter, values: dict
) -> GovernanceDiscordWorkspace:
    workspace = await get_workspace(db, matter.id)
    if workspace is None:
        workspace = GovernanceDiscordWorkspace(
            matter_id=matter.id,
            guild_id=values["guild_id"],
        )
        db.add(workspace)
    for key, value in values.items():
        setattr(workspace, key, value)
    workspace.sync_status = "idle"
    workspace.last_error = None
    await db.flush()
    return await get_workspace(db, matter.id)


async def list_routes(
    db: AsyncSession, workspace_id: uuid.UUID
) -> list[GovernanceDiscordEventRoute]:
    return list(
        (
            await db.execute(
                select(GovernanceDiscordEventRoute)
                .where(GovernanceDiscordEventRoute.workspace_id == workspace_id)
                .order_by(GovernanceDiscordEventRoute.event_type)
            )
        )
        .scalars()
        .all()
    )


async def upsert_route(
    db: AsyncSession,
    workspace: GovernanceDiscordWorkspace,
    values: dict,
) -> GovernanceDiscordEventRoute:
    route = await db.scalar(
        select(GovernanceDiscordEventRoute).where(
            GovernanceDiscordEventRoute.workspace_id == workspace.id,
            GovernanceDiscordEventRoute.event_type == values["event_type"],
        )
    )
    if route is None:
        route = GovernanceDiscordEventRoute(
            workspace_id=workspace.id,
            event_type=values["event_type"],
        )
        db.add(route)
    for key, value in values.items():
        setattr(route, key, value)
    await db.flush()
    await db.refresh(route)
    return route


async def enqueue_workspace_sync(db: AsyncSession, workspace: GovernanceDiscordWorkspace) -> None:
    matter = await db.get(Matter, workspace.matter_id)
    if matter is None:
        raise ValueError("治理事項不存在")
    org_role_ids: list[str] = []
    if matter.org_id:
        org_role_ids = list(
            (
                await db.execute(
                    select(DiscordRolePolicy.role_id).where(
                        DiscordRolePolicy.guild_id == workspace.guild_id,
                        DiscordRolePolicy.org_id == matter.org_id,
                        DiscordRolePolicy.is_active.is_(True),
                    )
                )
            ).scalars()
        )
    workspace.sync_status = "pending"
    workspace.last_error = None
    await emit(
        db,
        event_type="discord.governance_workspace_sync",
        payload={
            "workspace_id": str(workspace.id),
            "matter_id": str(matter.id),
            "matter_name": matter.title,
            "guild_id": workspace.guild_id,
            "mode": workspace.mode,
            "category_id": workspace.category_id,
            "discussion_channel_id": workspace.discussion_channel_id,
            "announcement_channel_id": workspace.announcement_channel_id,
            "staff_channel_id": workspace.staff_channel_id,
            "mention_role_id": workspace.mention_role_id,
            "org_role_ids": sorted(set(org_role_ids)),
        },
    )
    await db.flush()


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
            "link": href or f"/governance/{matter_id}",
            "thread_name": title[:80] if route.create_thread else None,
        },
    )


__all__ = [
    "apply_workspace_result",
    "emit_matter_event",
    "enqueue_workspace_sync",
    "get_workspace",
    "list_routes",
    "upsert_route",
    "upsert_workspace",
]
