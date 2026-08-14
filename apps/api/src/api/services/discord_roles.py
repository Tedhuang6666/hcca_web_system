"""Discord role mapping queries shared by bot and governance services."""

from __future__ import annotations

import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.discord_account import DiscordRoleMapping, DiscordRoleMappingKind
from api.models.org import Position, UserPosition
from api.services.permission import active_tenure_filter


async def list_active_role_ids_for_user(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[str, set[str]]:
    today = local_today()
    result = await db.execute(
        select(DiscordRoleMapping)
        .join(
            Position,
            or_(
                and_(
                    DiscordRoleMapping.mapping_kind == DiscordRoleMappingKind.POSITION,
                    DiscordRoleMapping.position_id == Position.id,
                ),
                and_(
                    DiscordRoleMapping.mapping_kind == DiscordRoleMappingKind.ORG,
                    DiscordRoleMapping.org_id == Position.org_id,
                ),
            ),
        )
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == user_id)
        .where(DiscordRoleMapping.is_active.is_(True))
        .where(*active_tenure_filter(today))
        .distinct()
    )
    rows = result.scalars().all()
    by_guild: dict[str, set[str]] = {}
    for row in rows:
        by_guild.setdefault(row.guild_id, set()).add(row.role_id)
    return by_guild
