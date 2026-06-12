"""活動職務與 Discord 工作區整合服務。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.models.activity import Activity, ActivityConvener
from api.models.activity_discord import (
    ActivityMember,
    ActivityRole,
    DiscordActivitySyncStatus,
    DiscordActivityWorkspace,
)
from api.models.discord_account import DiscordAccountLink
from api.models.user import User
from api.schemas.activity_discord import (
    ActivityMemberCreate,
    ActivityRoleCreate,
    ActivityRoleUpdate,
    DiscordActivityWorkspaceUpsert,
)
from api.services.outbox import emit


async def get_workspace(
    db: AsyncSession, activity_id: uuid.UUID
) -> DiscordActivityWorkspace | None:
    return await db.scalar(
        select(DiscordActivityWorkspace).where(DiscordActivityWorkspace.activity_id == activity_id)
    )


async def upsert_workspace(
    db: AsyncSession,
    activity: Activity,
    data: DiscordActivityWorkspaceUpsert,
) -> DiscordActivityWorkspace:
    workspace = await get_workspace(db, activity.id)
    fields = data.model_dump()
    if workspace is None:
        workspace = DiscordActivityWorkspace(activity_id=activity.id, guild_id=data.guild_id)
        db.add(workspace)
    elif workspace.guild_id != data.guild_id:
        workspace.category_id = None
        workspace.general_channel_id = None
        workspace.announcement_channel_id = None
        workspace.staff_channel_id = None
        workspace.convener_role_id = None
        roles = await list_roles(db, activity.id)
        for role in roles:
            role.discord_role_id = None
            role.discord_channel_id = None
        for field in (
            "category_id",
            "general_channel_id",
            "announcement_channel_id",
            "staff_channel_id",
            "convener_role_id",
        ):
            fields[field] = None
    for field, value in fields.items():
        setattr(workspace, field, value)
    workspace.sync_status = DiscordActivitySyncStatus.IDLE
    workspace.last_error = None
    await db.flush()
    await db.refresh(workspace)
    return workspace


async def list_roles(db: AsyncSession, activity_id: uuid.UUID) -> list[ActivityRole]:
    rows = await db.execute(
        select(ActivityRole)
        .where(ActivityRole.activity_id == activity_id)
        .order_by(ActivityRole.sort_order, ActivityRole.name)
    )
    return list(rows.scalars().all())


async def create_role(
    db: AsyncSession, activity: Activity, data: ActivityRoleCreate
) -> ActivityRole:
    duplicate = await db.scalar(
        select(ActivityRole.id).where(
            ActivityRole.activity_id == activity.id,
            ActivityRole.key == data.key,
        )
    )
    if duplicate is not None:
        raise ValueError("此活動職務代碼已存在")
    role = ActivityRole(activity_id=activity.id, **data.model_dump())
    db.add(role)
    await db.flush()
    await db.refresh(role)
    await enqueue_workspace_sync_if_enabled(db, activity.id)
    return role


async def update_role(
    db: AsyncSession, role: ActivityRole, data: ActivityRoleUpdate
) -> ActivityRole:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(role, field, value)
    await db.flush()
    await db.refresh(role)
    await enqueue_workspace_sync_if_enabled(db, role.activity_id)
    return role


async def list_members(db: AsyncSession, activity_id: uuid.UUID) -> list[ActivityMember]:
    rows = await db.execute(
        select(ActivityMember)
        .where(ActivityMember.activity_id == activity_id)
        .options(selectinload(ActivityMember.role), selectinload(ActivityMember.user))
        .order_by(ActivityMember.start_date.desc(), ActivityMember.created_at.desc())
    )
    return list(rows.scalars().all())


async def appoint_member(
    db: AsyncSession, activity: Activity, data: ActivityMemberCreate
) -> ActivityMember:
    role = await db.get(ActivityRole, data.role_id)
    if role is None or role.activity_id != activity.id or not role.is_active:
        raise ValueError("指定的活動職務不存在或已停用")
    if await db.get(User, data.user_id) is None:
        raise ValueError("指定的使用者不存在")
    new_end = data.end_date or date.max
    overlap = await db.scalar(
        select(ActivityMember.id)
        .where(
            ActivityMember.activity_id == activity.id,
            ActivityMember.role_id == data.role_id,
            ActivityMember.user_id == data.user_id,
            ActivityMember.start_date <= new_end,
            (ActivityMember.end_date.is_(None)) | (ActivityMember.end_date >= data.start_date),
        )
        .limit(1)
    )
    if overlap is not None:
        raise ValueError("此使用者已有重疊的活動職務任期")
    member = ActivityMember(activity_id=activity.id, **data.model_dump())
    db.add(member)
    await db.flush()
    await db.refresh(member, ["role", "user"])
    await enqueue_workspace_sync_if_enabled(db, activity.id)
    from api.services.discord_bot import enqueue_role_sync

    await enqueue_role_sync(db, member.user_id)
    return member


async def remove_member(db: AsyncSession, member: ActivityMember) -> None:
    activity_id = member.activity_id
    user_id = member.user_id
    await db.delete(member)
    await db.flush()
    await enqueue_workspace_sync_if_enabled(db, activity_id)
    from api.services.discord_bot import enqueue_role_sync

    await enqueue_role_sync(db, user_id)


async def _workspace_payload(
    db: AsyncSession,
    workspace: DiscordActivityWorkspace,
    *,
    archive: bool = False,
) -> dict:
    activity = await db.get(Activity, workspace.activity_id)
    if activity is None:
        raise ValueError("活動不存在")
    roles = await list_roles(db, activity.id)
    members = await list_members(db, activity.id)
    today = local_today()
    links = (
        await db.execute(
            select(DiscordAccountLink.user_id, DiscordAccountLink.discord_user_id).where(
                DiscordAccountLink.is_active.is_(True)
            )
        )
    ).all()
    discord_by_user = {user_id: discord_id for user_id, discord_id in links}
    conveners = (
        await db.execute(
            select(ActivityConvener.user_id).where(
                ActivityConvener.activity_id == activity.id,
                ActivityConvener.start_date <= today,
                (ActivityConvener.end_date.is_(None)) | (ActivityConvener.end_date >= today),
            )
        )
    ).scalars()
    return {
        "workspace_id": str(workspace.id),
        "activity_id": str(activity.id),
        "activity_name": activity.name,
        "guild_id": workspace.guild_id,
        "archive": archive,
        "category_id": workspace.category_id,
        "general_channel_id": workspace.general_channel_id,
        "announcement_channel_id": workspace.announcement_channel_id,
        "staff_channel_id": workspace.staff_channel_id,
        "convener_role_id": workspace.convener_role_id,
        "convener_discord_user_ids": sorted(
            discord_by_user[user_id] for user_id in conveners if user_id in discord_by_user
        ),
        "roles": [
            {
                "id": str(role.id),
                "key": role.key,
                "name": role.name,
                "discord_role_id": role.discord_role_id,
                "discord_channel_id": role.discord_channel_id,
                "create_private_channel": role.create_private_channel,
                "member_discord_user_ids": sorted(
                    discord_by_user[member.user_id]
                    for member in members
                    if member.role_id == role.id
                    and member.start_date <= today
                    and (member.end_date is None or member.end_date >= today)
                    and member.user_id in discord_by_user
                ),
            }
            for role in roles
            if role.is_active
        ],
    }


async def enqueue_workspace_sync(
    db: AsyncSession,
    workspace: DiscordActivityWorkspace,
    *,
    archive: bool = False,
) -> None:
    workspace.sync_status = (
        DiscordActivitySyncStatus.ARCHIVED if archive else DiscordActivitySyncStatus.PENDING
    )
    workspace.last_error = None
    await emit(
        db,
        event_type="discord.activity_workspace_sync",
        payload=await _workspace_payload(db, workspace, archive=archive),
    )
    await db.flush()


async def enqueue_workspace_sync_if_enabled(db: AsyncSession, activity_id: uuid.UUID) -> None:
    workspace = await get_workspace(db, activity_id)
    if workspace is not None and workspace.is_active and workspace.auto_sync:
        await enqueue_workspace_sync(db, workspace)


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
    workspace = await db.get(DiscordActivityWorkspace, parsed_id)
    if workspace is None:
        return
    if not success:
        workspace.sync_status = DiscordActivitySyncStatus.FAILED
        workspace.last_error = (error or "Discord 工作區同步失敗")[:2000]
        return
    workspace.category_id = result.get("category_id") or workspace.category_id
    workspace.general_channel_id = result.get("general_channel_id") or workspace.general_channel_id
    workspace.announcement_channel_id = (
        result.get("announcement_channel_id") or workspace.announcement_channel_id
    )
    workspace.staff_channel_id = result.get("staff_channel_id") or workspace.staff_channel_id
    workspace.convener_role_id = result.get("convener_role_id") or workspace.convener_role_id
    workspace.sync_status = (
        DiscordActivitySyncStatus.ARCHIVED
        if result.get("archived")
        else DiscordActivitySyncStatus.SYNCED
    )
    workspace.last_error = None
    workspace.last_synced_at = datetime.now(UTC)
    for role_result in result.get("roles", []):
        try:
            role_id = uuid.UUID(str(role_result["id"]))
        except (KeyError, TypeError, ValueError):
            continue
        role = await db.get(ActivityRole, role_id)
        if role is None or role.activity_id != workspace.activity_id:
            continue
        role.discord_role_id = role_result.get("discord_role_id") or role.discord_role_id
        role.discord_channel_id = role_result.get("discord_channel_id") or role.discord_channel_id
    user_ids = set(
        (
            await db.execute(
                select(ActivityMember.user_id).where(
                    ActivityMember.activity_id == workspace.activity_id
                )
            )
        ).scalars()
    )
    user_ids.update(
        (
            await db.execute(
                select(ActivityConvener.user_id).where(
                    ActivityConvener.activity_id == workspace.activity_id
                )
            )
        ).scalars()
    )
    from api.services.discord_bot import enqueue_role_sync

    for user_id in user_ids:
        await enqueue_role_sync(db, user_id)


__all__ = [
    "apply_workspace_result",
    "appoint_member",
    "create_role",
    "enqueue_workspace_sync",
    "enqueue_workspace_sync_if_enabled",
    "get_workspace",
    "list_members",
    "list_roles",
    "remove_member",
    "update_role",
    "upsert_workspace",
]
