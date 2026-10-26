"""Discord 指令領域 handler。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.database import engine
from api.core.load_signals import snapshot as load_snapshot
from api.core.maintenance import get_load_shed_force_mode, get_maintenance_state
from api.core.metrics import get_celery_stats, get_db_pool_stats, get_redis_stats
from api.models.org import Position, UserPosition
from api.models.user import User
from api.services import defense as defense_svc
from api.services import petition as petition_svc
from api.services.discord_bot import (
    bot_health_snapshot,
    create_open_url,
    enqueue_all_role_sync,
    enqueue_role_sync,
)
from api.services.discord_command_common import (
    DiscordCommandError,
    _audit,
    _has_permission,
    _task,
)
from api.services.permission import (
    active_tenure_filter,
)
from api.services.task_inbox import build_task_inbox


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
    if operation == "tasks":
        inbox = await build_task_inbox(db, user)
        return {
            "total": inbox.total,
            "items": [_task(item) for item in inbox.items],
            "open_url": await create_open_url(user.id, "/dashboard"),
        }
    if operation == "dashboard":
        inbox = await build_task_inbox(db, user)
        positions = (
            await db.execute(
                select(Position.name)
                .join(UserPosition, UserPosition.position_id == Position.id)
                .where(UserPosition.user_id == user.id)
                .where(*active_tenure_filter(local_today()))
                .distinct()
            )
        ).scalars()
        cases = await petition_svc.list_cases(db, assigned_to_id=user.id, limit=25)
        return {
            "display_name": user.display_name,
            "positions": list(positions),
            "tasks": [_task(item) for item in inbox.items],
            "petitions": [
                {
                    "id": str(item.id),
                    "case_number": item.case_number,
                    "title": item.title,
                    "status": str(item.status),
                }
                for item in cases
            ],
            "open_url": await create_open_url(user.id, "/dashboard"),
        }
    if operation == "sync_me":
        await enqueue_role_sync(db, user.id)
        return {}
    if operation == "unlink":
        from api.services.discord_bot import unlink_user

        await unlink_user(db, user.id)
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="discord_account_link",
            entity_id=str(user.id),
            action="discord.unlink",
            summary="使用者經 Discord 解除綁定",
            meta={"discord_user_id": discord_user_id},
        )
        return {}
    if operation == "sync_all":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有 Discord 社群管理權限。")
        queued = await enqueue_all_role_sync(db)
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="discord_account_link",
            entity_id="all",
            action="discord.sync_all",
            summary="Discord 排程同步所有已綁定成員",
            meta={"queued": queued},
        )
        return {"queued": queued}
    if operation == "system_status":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有系統管理權限。")
        pool = get_db_pool_stats(engine)
        return {
            "db_checked_out": pool.checked_out,
            "db_utilization": pool.utilization,
            "redis": await get_redis_stats(),
            "celery": await get_celery_stats(),
            "maintenance": await get_maintenance_state(),
            "load_shed": await get_load_shed_force_mode(),
            "load": load_snapshot(),
        }
    if operation == "defense_summary":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有系統管理權限。")
        return await defense_svc.summary(db)
    if operation == "server_health":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有 Discord 社群管理權限。")
        from api.services.discord_commands import execute

        return {
            "system": await execute(
                db,
                operation="system_status",
                discord_user_id=discord_user_id,
                interaction_id=interaction_id,
                guild_id=guild_id,
                arguments={},
            ),
            "defense": await defense_svc.summary(db),
            "bot": await bot_health_snapshot(db),
        }
    if operation == "shortlink":
        path = str(arguments["path"])
        if not path.startswith("/"):
            raise DiscordCommandError("path 必須以 / 開頭。")
        return {"url": await create_open_url(user.id, path)}

    return None
