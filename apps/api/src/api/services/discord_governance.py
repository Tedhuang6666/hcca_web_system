"""Discord 角色政策、暱稱基線與成員差異管理。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.activity import ActivityConvener
from api.models.activity_discord import (
    ActivityMember,
    ActivityRole,
    DiscordActivityWorkspace,
)
from api.models.discord_account import (
    DiscordAccountLink,
    DiscordMemberSyncState,
    DiscordRoleMapping,
    DiscordRolePolicy,
)
from api.models.org import Position, UserPosition
from api.services.permission import active_tenure_filter


def select_prefix_labels(policies: list[DiscordRolePolicy]) -> list[str]:
    """依優先級取最多兩個不重複暱稱標籤。"""
    labels: list[str] = []
    for policy in sorted(policies, key=lambda row: (row.priority, str(row.id))):
        label = (policy.nickname_label or "").strip()
        if not policy.is_active or not policy.use_in_nickname or not label or label in labels:
            continue
        labels.append(label)
        if len(labels) == 2:
            break
    return labels


def compose_nickname(labels: list[str], base_nickname: str) -> tuple[str, str | None]:
    """組成 Discord 暱稱；超長時先移除第二標籤，再截短原暱稱。"""
    base = base_nickname.strip() or "Discord member"
    selected = list(dict.fromkeys(label.strip() for label in labels if label.strip()))[:2]
    while selected:
        prefix = "&".join(selected)
        nickname = f"{prefix}｜{base}"
        if len(nickname) <= 32:
            return nickname, prefix
        if len(selected) == 2:
            selected.pop()
            continue
        available = max(1, 32 - len(prefix) - 1)
        return f"{prefix}｜{base[:available]}", prefix
    return base[:32], None


def remove_applied_prefix(nickname: str, applied_prefix: str | None) -> str:
    if applied_prefix:
        marker = f"{applied_prefix}｜"
        if nickname.startswith(marker):
            return nickname[len(marker) :]
    return nickname


async def list_role_policies(
    db: AsyncSession, *, guild_id: str | None = None
) -> list[DiscordRolePolicy]:
    stmt = select(DiscordRolePolicy).order_by(
        DiscordRolePolicy.guild_id,
        DiscordRolePolicy.priority,
        DiscordRolePolicy.role_name,
    )
    if guild_id:
        stmt = stmt.where(DiscordRolePolicy.guild_id == guild_id)
    return list((await db.execute(stmt)).scalars().all())


async def upsert_role_policy(
    db: AsyncSession,
    *,
    policy_id: uuid.UUID | None,
    values: dict,
) -> DiscordRolePolicy:
    policy = await db.get(DiscordRolePolicy, policy_id) if policy_id else None
    if policy is None:
        policy = await db.scalar(
            select(DiscordRolePolicy).where(
                DiscordRolePolicy.guild_id == values["guild_id"],
                DiscordRolePolicy.role_id == values["role_id"],
            )
        )
    if policy is None:
        policy = DiscordRolePolicy(
            guild_id=values["guild_id"],
            role_id=values["role_id"],
        )
        db.add(policy)
    for key, value in values.items():
        setattr(policy, key, value)
    await db.flush()
    await db.refresh(policy)
    return policy


async def desired_policy_role_ids_for_user(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[str, set[str]]:
    today = local_today()
    rows = (
        await db.execute(
            select(DiscordRolePolicy)
            .join(
                Position,
                or_(
                    DiscordRolePolicy.position_id == Position.id,
                    and_(
                        DiscordRolePolicy.position_id.is_(None),
                        DiscordRolePolicy.org_id == Position.org_id,
                    ),
                ),
            )
            .join(UserPosition, UserPosition.position_id == Position.id)
            .where(
                UserPosition.user_id == user_id,
                DiscordRolePolicy.is_active.is_(True),
                DiscordRolePolicy.manage_role.is_(True),
                *active_tenure_filter(today),
            )
            .distinct()
        )
    ).scalars()
    by_guild: dict[str, set[str]] = {}
    for row in rows:
        by_guild.setdefault(row.guild_id, set()).add(row.role_id)
    return by_guild


async def policies_for_roles(
    db: AsyncSession, guild_id: str, role_ids: set[str]
) -> list[DiscordRolePolicy]:
    if not role_ids:
        return []
    return list(
        (
            await db.execute(
                select(DiscordRolePolicy).where(
                    DiscordRolePolicy.guild_id == guild_id,
                    DiscordRolePolicy.role_id.in_(role_ids),
                    DiscordRolePolicy.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )


async def managed_role_ids(db: AsyncSession, guild_id: str) -> set[str]:
    policy_rows = (
        await db.execute(
            select(DiscordRolePolicy.role_id).where(
                DiscordRolePolicy.guild_id == guild_id,
                DiscordRolePolicy.is_active.is_(True),
                DiscordRolePolicy.manage_role.is_(True),
            )
        )
    ).scalars()
    legacy_rows = (
        await db.execute(
            select(DiscordRoleMapping.role_id).where(
                DiscordRoleMapping.guild_id == guild_id,
                DiscordRoleMapping.is_active.is_(True),
            )
        )
    ).scalars()
    activity_rows = (
        await db.execute(
            select(ActivityRole.discord_role_id)
            .join(
                DiscordActivityWorkspace,
                DiscordActivityWorkspace.activity_id == ActivityRole.activity_id,
            )
            .where(
                DiscordActivityWorkspace.guild_id == guild_id,
                DiscordActivityWorkspace.is_active.is_(True),
                ActivityRole.is_active.is_(True),
                ActivityRole.discord_role_id.is_not(None),
            )
        )
    ).scalars()
    convener_rows = (
        await db.execute(
            select(DiscordActivityWorkspace.convener_role_id).where(
                DiscordActivityWorkspace.guild_id == guild_id,
                DiscordActivityWorkspace.is_active.is_(True),
                DiscordActivityWorkspace.convener_role_id.is_not(None),
            )
        )
    ).scalars()
    return set(policy_rows) | set(legacy_rows) | set(activity_rows) | set(convener_rows)


async def activity_role_ids_for_user(
    db: AsyncSession, *, user_id: uuid.UUID, guild_id: str
) -> set[str]:
    today = local_today()
    member_rows = (
        await db.execute(
            select(ActivityRole.discord_role_id)
            .join(ActivityMember, ActivityMember.role_id == ActivityRole.id)
            .join(
                DiscordActivityWorkspace,
                DiscordActivityWorkspace.activity_id == ActivityRole.activity_id,
            )
            .where(
                ActivityMember.user_id == user_id,
                ActivityMember.start_date <= today,
                or_(ActivityMember.end_date.is_(None), ActivityMember.end_date >= today),
                DiscordActivityWorkspace.guild_id == guild_id,
                DiscordActivityWorkspace.is_active.is_(True),
                ActivityRole.is_active.is_(True),
                ActivityRole.discord_role_id.is_not(None),
            )
        )
    ).scalars()
    convener_rows = (
        await db.execute(
            select(DiscordActivityWorkspace.convener_role_id)
            .join(
                ActivityConvener,
                ActivityConvener.activity_id == DiscordActivityWorkspace.activity_id,
            )
            .where(
                ActivityConvener.user_id == user_id,
                ActivityConvener.start_date <= today,
                or_(ActivityConvener.end_date.is_(None), ActivityConvener.end_date >= today),
                DiscordActivityWorkspace.guild_id == guild_id,
                DiscordActivityWorkspace.is_active.is_(True),
                DiscordActivityWorkspace.convener_role_id.is_not(None),
            )
        )
    ).scalars()
    return set(member_rows) | set(convener_rows)


async def get_or_create_member_state(
    db: AsyncSession,
    *,
    guild_id: str,
    discord_user_id: str,
    user_id: uuid.UUID | None,
) -> DiscordMemberSyncState:
    state = await db.scalar(
        select(DiscordMemberSyncState).where(
            DiscordMemberSyncState.guild_id == guild_id,
            DiscordMemberSyncState.discord_user_id == discord_user_id,
        )
    )
    if state is None:
        state = DiscordMemberSyncState(
            guild_id=guild_id,
            discord_user_id=discord_user_id,
            user_id=user_id,
        )
        db.add(state)
        await db.flush()
    elif user_id is not None:
        state.user_id = user_id
    return state


async def observe_member(
    db: AsyncSession,
    *,
    guild_id: str,
    discord_user_id: str,
    nickname: str,
    role_ids: set[str],
) -> DiscordMemberSyncState:
    link = await db.scalar(
        select(DiscordAccountLink).where(
            DiscordAccountLink.discord_user_id == discord_user_id,
            DiscordAccountLink.is_active.is_(True),
        )
    )
    state = await get_or_create_member_state(
        db,
        guild_id=guild_id,
        discord_user_id=discord_user_id,
        user_id=link.user_id if link else None,
    )
    base_nickname = remove_applied_prefix(nickname, state.last_applied_prefix)
    if nickname != state.expected_nickname or state.base_nickname is None:
        state.base_nickname = base_nickname
    policies = await policies_for_roles(db, guild_id, role_ids)
    expected_nickname, _ = compose_nickname(select_prefix_labels(policies), state.base_nickname)
    desired: set[str] = set()
    if link is not None:
        from api.services.discord_bot import list_active_role_ids_for_user

        desired.update((await list_active_role_ids_for_user(db, link.user_id)).get(guild_id, set()))
        desired.update(
            await activity_role_ids_for_user(
                db,
                user_id=link.user_id,
                guild_id=guild_id,
            )
        )
    managed = await managed_role_ids(db, guild_id)
    state.actual_role_ids = sorted(role_ids)
    state.desired_role_ids = sorted(desired)
    state.actual_nickname = nickname
    state.expected_nickname = expected_nickname
    state.has_role_drift = (role_ids & managed) != desired
    state.last_seen_at = datetime.now(UTC)
    state.last_error = None
    await db.flush()
    return state


async def list_member_states(
    db: AsyncSession, *, guild_id: str | None = None, drift_only: bool = False
) -> list[DiscordMemberSyncState]:
    stmt = select(DiscordMemberSyncState).order_by(
        DiscordMemberSyncState.has_role_drift.desc(),
        DiscordMemberSyncState.updated_at.desc(),
    )
    if guild_id:
        stmt = stmt.where(DiscordMemberSyncState.guild_id == guild_id)
    if drift_only:
        stmt = stmt.where(DiscordMemberSyncState.has_role_drift.is_(True))
    return list((await db.execute(stmt)).scalars().all())


__all__ = [
    "compose_nickname",
    "activity_role_ids_for_user",
    "desired_policy_role_ids_for_user",
    "get_or_create_member_state",
    "list_member_states",
    "list_role_policies",
    "managed_role_ids",
    "observe_member",
    "policies_for_roles",
    "remove_applied_prefix",
    "select_prefix_labels",
    "upsert_role_policy",
]
