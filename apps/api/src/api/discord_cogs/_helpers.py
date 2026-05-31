"""Discord cog 共用工具：權限檢查、綁定查詢、審計記錄。"""

from __future__ import annotations

import discord

from api.core.database import AsyncSessionLocal
from api.models.user import User
from api.services import audit as audit_svc
from api.services.discord_bot import emit_moderation_log, get_user_by_discord_id
from api.services.permission import get_user_permission_codes


def has_permission(user: User, codes: frozenset[str], code: str) -> bool:
    return user.is_superuser or "admin:all" in codes or code in codes


async def bound_user(interaction: discord.Interaction) -> User | None:
    async with AsyncSessionLocal() as db:
        return await get_user_by_discord_id(db, str(interaction.user.id))


async def require_bound_user(interaction: discord.Interaction) -> User | None:
    user = await bound_user(interaction)
    if user is None:
        await interaction.response.send_message(
            "請先到平台個人資料頁綁定 Discord，再使用辦公功能。", ephemeral=True
        )
        return None
    return user


async def require_platform_admin(interaction: discord.Interaction) -> User | None:
    user = await require_bound_user(interaction)
    if user is None:
        return None
    async with AsyncSessionLocal() as db:
        codes = await get_user_permission_codes(db, user.id)
    if not has_permission(user, codes, "admin:all"):
        await interaction.response.send_message("你沒有 Discord 社群管理權限。", ephemeral=True)
        return None
    return user


async def audit_discord_action(
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


__all__ = [
    "audit_discord_action",
    "bound_user",
    "has_permission",
    "require_bound_user",
    "require_platform_admin",
]
