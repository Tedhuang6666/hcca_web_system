"""Discord 指令共用身分、權限與稽核邏輯。"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.discord_account import DEFAULT_DM_CATEGORIES, DiscordNotificationPreference
from api.models.org import Position, UserPosition
from api.models.user import User
from api.services import audit as audit_svc
from api.services.discord_bot import (
    emit_moderation_log,
    get_user_by_discord_id,
)
from api.services.permission import (
    active_tenure_filter,
    get_user_permission_codes,
)


class DiscordCommandError(ValueError):
    pass


def _has_permission(user: User, codes: frozenset[str], code: str) -> bool:
    return user.is_superuser or "admin:all" in codes or code in codes


async def _actor(db: AsyncSession, discord_user_id: str) -> tuple[User, frozenset[str]]:
    user = await get_user_by_discord_id(db, discord_user_id)
    if user is None:
        raise DiscordCommandError("請先到平台個人資料頁綁定 Discord，再使用辦公功能。")
    return user, await get_user_permission_codes(db, user.id)


async def _require(
    db: AsyncSession, discord_user_id: str, permission: str
) -> tuple[User, frozenset[str]]:
    user, codes = await _actor(db, discord_user_id)
    if not _has_permission(user, codes, permission):
        raise DiscordCommandError("你沒有執行此操作的權限。")
    return user, codes


async def _primary_org(db: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    org_id = await db.scalar(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == user_id)
        .where(*active_tenure_filter(local_today()))
        .limit(1)
    )
    if org_id is None:
        raise DiscordCommandError("找不到你的所屬機關，請先在平台確認任期。")
    return org_id


async def _audit(
    db: AsyncSession,
    user: User,
    *,
    interaction_id: str,
    guild_id: str | None,
    entity_type: str,
    entity_id: str,
    action: str,
    summary: str,
    meta: dict[str, Any] | None = None,
) -> None:
    detail = {**(meta or {}), "discord_interaction_id": interaction_id}
    await audit_svc.record(
        db,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=str(user.id),
        actor_email=user.email,
        meta=detail,
        summary=summary,
    )
    if action.startswith("discord.community."):
        await emit_moderation_log(
            db,
            guild_id=guild_id,
            title=summary,
            body="\n".join(f"{key}: {value}" for key, value in detail.items()),
        )


def _task(item: Any) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "title": item.title,
        "subtitle": item.subtitle,
        "module": item.module,
        "href": item.href,
        "due_at": item.due_at.isoformat() if item.due_at else None,
    }


async def _preference(db: AsyncSession, user_id: uuid.UUID) -> DiscordNotificationPreference:
    pref = await db.get(DiscordNotificationPreference, user_id)
    if pref is None:
        pref = DiscordNotificationPreference(
            user_id=user_id,
            preferences=dict(DEFAULT_DM_CATEGORIES),
        )
        db.add(pref)
        await db.flush()
    return pref


def _preference_data(pref: DiscordNotificationPreference) -> dict[str, Any]:
    return {
        "preferences": pref.preferences or {},
        "digest_daily_enabled": pref.digest_daily_enabled,
        "digest_weekly_enabled": pref.digest_weekly_enabled,
        "quiet_hours_start": (
            pref.quiet_hours_start.strftime("%H:%M") if pref.quiet_hours_start else None
        ),
        "quiet_hours_end": (
            pref.quiet_hours_end.strftime("%H:%M") if pref.quiet_hours_end else None
        ),
        "timezone": pref.timezone,
    }
