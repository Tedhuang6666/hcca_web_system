"""獨立 Discord Bot 的 API gateway。

此模組只處理平台資料與 outbox 狀態。Discord Gateway/REST 操作由獨立 Bot instance
執行，API 與 Celery 不再負責送訊息或操作 guild。
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.prometheus_metrics import record_outbox_delivery
from api.core.security import redis_client
from api.models.discord_account import DiscordAccountLink, DiscordNotificationPreference
from api.models.outbox import OutboxEvent, OutboxStatus
from api.models.petition import PetitionCase
from api.services.discord_bot import (
    emit_moderation_log,
    emit_welcome_message,
    enqueue_role_sync,
    get_user_by_discord_id,
)

logger = logging.getLogger(__name__)

_LEASE_PREFIX = "discord:delivery:lease:"
_LEASE_SECONDS = 60
_MAX_RETRY = 5
_INVENTORY_KEY = "discord:bot:inventory"
_INVENTORY_TTL_SECONDS = 60


def _in_quiet_hours(preference: DiscordNotificationPreference | None) -> bool:
    if preference is None:
        return False
    start = preference.quiet_hours_start
    end = preference.quiet_hours_end
    if start is None or end is None:
        return False
    try:
        now_local = datetime.now(ZoneInfo(preference.timezone or "Asia/Taipei")).time()
    except Exception:
        now_local = datetime.now(UTC).time()
    if start <= end:
        return start <= now_local < end
    return now_local >= start or now_local < end


async def _normalize_payload(db: AsyncSession, event: OutboxEvent) -> dict[str, Any] | None:
    payload = dict(event.payload)
    if event.event_type != "discord.user_dm":
        return payload

    try:
        user_id = uuid.UUID(str(payload["user_id"]))
    except (KeyError, TypeError, ValueError):
        logger.warning("Discord user_dm event %s has invalid user_id", event.id)
        return None

    link = await db.scalar(
        select(DiscordAccountLink).where(
            DiscordAccountLink.user_id == user_id,
            DiscordAccountLink.is_active.is_(True),
        )
    )
    if link is None:
        return None

    preference = await db.scalar(
        select(DiscordNotificationPreference).where(
            DiscordNotificationPreference.user_id == user_id
        )
    )
    category = payload.get("category")
    if (
        category
        and preference is not None
        and not bool((preference.preferences or {}).get(str(category), True))
    ):
        return None
    if _in_quiet_hours(preference):
        return None

    payload.pop("user_id", None)
    payload["discord_user_id"] = link.discord_user_id
    return payload


async def claim_next_event(db: AsyncSession) -> tuple[OutboxEvent, dict[str, Any]] | None:
    rows = (
        await db.execute(
            select(OutboxEvent)
            .where(
                OutboxEvent.status == OutboxStatus.PENDING,
                OutboxEvent.event_type.like("discord.%"),
            )
            .order_by(OutboxEvent.created_at)
            .limit(25)
        )
    ).scalars()
    for event in rows:
        lease_key = f"{_LEASE_PREFIX}{event.id}"
        leased = await redis_client.set(lease_key, "1", ex=_LEASE_SECONDS, nx=True)
        if not leased:
            continue
        payload = await _normalize_payload(db, event)
        if payload is None:
            event.status = OutboxStatus.PROCESSED
            event.processed_at = datetime.now(UTC)
            record_outbox_delivery(event.event_type, "skipped")
            await redis_client.delete(lease_key)
            await db.flush()
            continue
        return event, payload
    return None


async def acknowledge_event(
    db: AsyncSession,
    event_id: uuid.UUID,
    *,
    success: bool,
    error: str | None,
    result: dict[str, Any],
) -> bool:
    event = await db.get(OutboxEvent, event_id)
    if event is None or not event.event_type.startswith("discord."):
        return False

    if success:
        event.status = OutboxStatus.PROCESSED
        event.processed_at = datetime.now(UTC)
        event.last_error = None
        record_outbox_delivery(event.event_type, "processed")
        if event.event_type == "discord.petition_channel_create":
            await _save_petition_channel(db, event.payload, result)
        elif event.event_type == "discord.activity_workspace_sync":
            from api.services.activity_discord import apply_workspace_result

            await apply_workspace_result(
                db,
                str(event.payload.get("workspace_id") or ""),
                success=True,
                error=None,
                result=result,
            )
    else:
        event.retry_count += 1
        event.last_error = (error or "Discord Bot delivery failed")[:2000]
        if event.retry_count >= _MAX_RETRY:
            event.status = OutboxStatus.DEAD
            record_outbox_delivery(event.event_type, "dead")
        else:
            record_outbox_delivery(event.event_type, "retry")
        if event.event_type == "discord.activity_workspace_sync":
            from api.services.activity_discord import apply_workspace_result

            await apply_workspace_result(
                db,
                str(event.payload.get("workspace_id") or ""),
                success=False,
                error=error,
                result=result,
            )

    await redis_client.delete(f"{_LEASE_PREFIX}{event.id}")
    await db.flush()
    return True


async def _save_petition_channel(
    db: AsyncSession, payload: dict[str, Any], result: dict[str, Any]
) -> None:
    channel_id = result.get("channel_id")
    guild_id = result.get("guild_id") or payload.get("guild_id")
    if not channel_id or not guild_id:
        return
    try:
        case_id = uuid.UUID(str(payload["case_id"]))
    except (KeyError, TypeError, ValueError):
        return
    case_obj = await db.get(PetitionCase, case_id)
    if case_obj is None:
        return
    case_obj.discord_guild_id = str(guild_id)
    case_obj.discord_channel_id = str(channel_id)
    case_obj.discord_channel_created_at = datetime.now(UTC)


async def handle_member_joined(
    db: AsyncSession,
    *,
    guild_id: str,
    discord_user_id: str,
    display_name: str,
) -> str | None:
    user = await get_user_by_discord_id(db, discord_user_id)
    if user is not None:
        await enqueue_role_sync(db, user.id)
        await emit_moderation_log(
            db,
            guild_id=guild_id,
            title="Discord 成員加入並已綁定平台",
            body=f"{display_name} / {user.display_name}",
        )
    await emit_welcome_message(
        db,
        guild_id=guild_id,
        discord_user_id=discord_user_id,
        display_name=display_name,
    )
    return user.display_name if user is not None else None


async def write_inventory(payload: dict[str, Any]) -> None:
    await redis_client.set(
        _INVENTORY_KEY,
        json.dumps(payload),
        ex=_INVENTORY_TTL_SECONDS,
    )


async def read_inventory() -> dict[str, Any] | None:
    raw = await redis_client.get(_INVENTORY_KEY)
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


async def inventory_guilds() -> list[dict[str, Any]]:
    inventory = await read_inventory()
    return list(inventory.get("guilds", [])) if inventory else []


async def inventory_guild(guild_id: str) -> dict[str, Any] | None:
    for guild in await inventory_guilds():
        if str(guild.get("id")) == guild_id:
            return guild
    return None


__all__ = [
    "acknowledge_event",
    "claim_next_event",
    "handle_member_joined",
    "inventory_guild",
    "inventory_guilds",
    "read_inventory",
    "write_inventory",
]
