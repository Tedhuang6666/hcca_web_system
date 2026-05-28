"""Discord 整合服務：OAuth 綁定、短效入口、通知推播與角色同步。"""

from __future__ import annotations

import json
import logging
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.security import redis_client
from api.models.discord_account import (
    DiscordAccountLink,
    DiscordGuildConfig,
    DiscordRoleMapping,
    DiscordRoleMappingKind,
)
from api.models.org import Position, UserPosition
from api.models.user import User
from api.services.permission import active_tenure_filter

logger = logging.getLogger(__name__)

_OPEN_TOKEN_PREFIX = "discord:open:"
_OPEN_TOKEN_TTL_SECONDS = 5 * 60


def is_configured() -> bool:
    return bool(settings.DISCORD_CLIENT_ID and settings.DISCORD_CLIENT_SECRET)


def bot_configured() -> bool:
    return bool(settings.DISCORD_BOT_TOKEN)


def _safe_frontend_path(path: str | None) -> str:
    if not path or not path.startswith("/") or path.startswith("//"):
        return "/"
    return path


def _absolute_url(path: str | None) -> str:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    if not path:
        return base
    if path.startswith(("http://", "https://")):
        return path
    return f"{base}{path if path.startswith('/') else '/' + path}"


async def create_open_url(user_id: uuid.UUID, path: str | None) -> str:
    token = secrets.token_urlsafe(32)
    await redis_client.setex(
        f"{_OPEN_TOKEN_PREFIX}{token}",
        _OPEN_TOKEN_TTL_SECONDS,
        json.dumps({"user_id": str(user_id), "path": _safe_frontend_path(path)}),
    )
    return _absolute_url(f"/discord/open?token={token}")


async def consume_open_token(token: str) -> tuple[uuid.UUID, str] | None:
    key = f"{_OPEN_TOKEN_PREFIX}{token}"
    raw = await redis_client.get(key)
    if not raw:
        return None
    await redis_client.delete(key)
    try:
        payload = json.loads(raw)
        return uuid.UUID(payload["user_id"]), _safe_frontend_path(payload.get("path"))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


async def get_user_link(db: AsyncSession, user_id: uuid.UUID) -> DiscordAccountLink | None:
    return await db.scalar(
        select(DiscordAccountLink).where(
            DiscordAccountLink.user_id == user_id,
            DiscordAccountLink.is_active.is_(True),
        )
    )


async def get_user_by_discord_id(db: AsyncSession, discord_user_id: str) -> User | None:
    return await db.scalar(
        select(User)
        .join(DiscordAccountLink, DiscordAccountLink.user_id == User.id)
        .where(DiscordAccountLink.discord_user_id == discord_user_id)
        .where(DiscordAccountLink.is_active.is_(True))
        .where(User.is_active.is_(True))
    )


async def unlink_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    link = await get_user_link(db, user_id)
    if link is None:
        return
    link.is_active = False
    link.unlinked_at = datetime.now(UTC)
    await db.flush()


async def upsert_user_link(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    discord_user_id: str,
    username: str | None,
    global_name: str | None,
    avatar_hash: str | None,
) -> DiscordAccountLink:
    now = datetime.now(UTC)
    user_link = await db.scalar(
        select(DiscordAccountLink).where(DiscordAccountLink.user_id == user_id)
    )
    discord_link = await db.scalar(
        select(DiscordAccountLink).where(DiscordAccountLink.discord_user_id == discord_user_id)
    )
    if user_link and discord_link and user_link.id != discord_link.id:
        await db.delete(user_link)
        await db.flush()
    link = discord_link or user_link
    if link is None:
        link = DiscordAccountLink(user_id=user_id, discord_user_id=discord_user_id)
        db.add(link)
    link.user_id = user_id
    link.discord_user_id = discord_user_id
    link.username = username
    link.global_name = global_name
    link.avatar_hash = avatar_hash
    link.is_active = True
    link.linked_at = now
    link.unlinked_at = None
    await db.flush()
    return link


async def list_active_role_ids_for_user(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[str, set[str]]:
    today = datetime.now(UTC).date()
    rows = (
        await db.execute(
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
        .scalars()
        .all()
    )
    by_guild: dict[str, set[str]] = {}
    for row in rows:
        by_guild.setdefault(row.guild_id, set()).add(row.role_id)
    return by_guild


async def enqueue_role_sync(db: AsyncSession, user_id: uuid.UUID) -> None:
    from api.services.outbox import emit

    link = await get_user_link(db, user_id)
    if link is None:
        return
    desired = await list_active_role_ids_for_user(db, user_id)
    mapped_rows = (
        await db.execute(select(DiscordRoleMapping.guild_id, DiscordRoleMapping.role_id))
    ).all()
    all_mapped_by_guild: dict[str, set[str]] = {}
    for guild_id, role_id in mapped_rows:
        all_mapped_by_guild.setdefault(guild_id, set()).add(role_id)
    for guild_id, managed_role_ids in all_mapped_by_guild.items():
        role_ids = desired.get(guild_id, set())
        await emit(
            db,
            event_type="discord.role_sync",
            payload={
                "guild_id": guild_id,
                "discord_user_id": link.discord_user_id,
                "role_ids": sorted(role_ids),
                "managed_role_ids": sorted(managed_role_ids),
            },
        )


async def get_primary_guild_config(db: AsyncSession) -> DiscordGuildConfig | None:
    guild_id = settings.DISCORD_GUILD_ID or settings.DISCORD_COMMAND_SYNC_GUILD_ID
    stmt = select(DiscordGuildConfig).where(DiscordGuildConfig.is_active.is_(True))
    if guild_id:
        stmt = stmt.where(DiscordGuildConfig.guild_id == guild_id)
    return await db.scalar(stmt.order_by(DiscordGuildConfig.updated_at.desc()).limit(1))


async def emit_security_alert(db: AsyncSession, *, title: str, body: str | None = None) -> None:
    from api.services.outbox import emit

    config = await get_primary_guild_config(db)
    if config is None or not config.security_alert_channel_id:
        return
    await emit(
        db,
        event_type="discord.channel_alert",
        payload={
            "channel_id": config.security_alert_channel_id,
            "title": title,
            "body": body,
        },
    )


def _discord_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bot {settings.DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json",
    }


async def fetch_bot_guilds() -> list[dict[str, Any]]:
    if not bot_configured():
        return []
    async with httpx.AsyncClient(timeout=10.0, headers=_discord_headers()) as client:
        res = await client.get("https://discord.com/api/v10/users/@me/guilds")
        res.raise_for_status()
        return list(res.json())


async def fetch_guild_channels(guild_id: str) -> list[dict[str, Any]]:
    if not bot_configured():
        return []
    async with httpx.AsyncClient(timeout=10.0, headers=_discord_headers()) as client:
        res = await client.get(f"https://discord.com/api/v10/guilds/{guild_id}/channels")
        res.raise_for_status()
        return list(res.json())


async def fetch_guild_roles(guild_id: str) -> list[dict[str, Any]]:
    if not bot_configured():
        return []
    async with httpx.AsyncClient(timeout=10.0, headers=_discord_headers()) as client:
        res = await client.get(f"https://discord.com/api/v10/guilds/{guild_id}/roles")
        res.raise_for_status()
        return list(res.json())


def send_dm(
    discord_user_id: str, *, title: str, body: str | None = None, link: str | None = None
) -> None:
    if not bot_configured():
        logger.warning("Discord Bot 未設定，跳過 DM")
        return
    text = title
    if body:
        text = f"{text}\n{body}"
    if link:
        text = f"{text}\n{_absolute_url(link)}"
    with httpx.Client(timeout=10.0, headers=_discord_headers()) as client:
        channel = client.post(
            "https://discord.com/api/v10/users/@me/channels",
            json={"recipient_id": discord_user_id},
        )
        channel.raise_for_status()
        channel_id = channel.json()["id"]
        message = client.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            json={"content": text[:1900]},
        )
        message.raise_for_status()


def send_channel_message(channel_id: str, *, title: str, body: str | None = None) -> None:
    if not bot_configured():
        logger.warning("Discord Bot 未設定，跳過頻道訊息")
        return
    content = title if body is None else f"{title}\n{body}"
    with httpx.Client(timeout=10.0, headers=_discord_headers()) as client:
        res = client.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            json={"content": content[:1900]},
        )
        res.raise_for_status()


def sync_member_roles(
    guild_id: str,
    discord_user_id: str,
    role_ids: list[str],
    managed_role_ids: list[str] | None = None,
) -> None:
    if not bot_configured():
        logger.warning("Discord Bot 未設定，跳過角色同步")
        return
    with httpx.Client(timeout=10.0, headers=_discord_headers()) as client:
        if managed_role_ids is not None:
            member = client.get(
                f"https://discord.com/api/v10/guilds/{guild_id}/members/{discord_user_id}"
            )
            member.raise_for_status()
            current_roles = set(member.json().get("roles") or [])
            desired = set(role_ids)
            for role_id in set(managed_role_ids) - desired:
                if role_id in current_roles:
                    res = client.delete(
                        f"https://discord.com/api/v10/guilds/{guild_id}/members/{discord_user_id}/roles/{role_id}"
                    )
                    res.raise_for_status()
        for role_id in role_ids:
            res = client.put(
                f"https://discord.com/api/v10/guilds/{guild_id}/members/{discord_user_id}/roles/{role_id}"
            )
            res.raise_for_status()
    logger.info(
        "Discord 角色同步完成 guild=%s user=%s roles=%d", guild_id, discord_user_id, len(role_ids)
    )


def format_discord_payload(payload: dict[str, Any]) -> tuple[str, str | None]:
    title = str(payload.get("title") or "HCCA 平台通知")
    body = payload.get("body")
    link = payload.get("link")
    if link:
        href = str(link)
        if not href.startswith(("http://", "https://")):
            href = _absolute_url(href)
        body = f"{body}\n{href}" if body else href
    return title, str(body) if body else None


__all__ = [
    "bot_configured",
    "consume_open_token",
    "create_open_url",
    "emit_security_alert",
    "enqueue_role_sync",
    "format_discord_payload",
    "fetch_bot_guilds",
    "fetch_guild_channels",
    "fetch_guild_roles",
    "get_primary_guild_config",
    "get_user_by_discord_id",
    "get_user_link",
    "is_configured",
    "send_channel_message",
    "send_dm",
    "sync_member_roles",
    "unlink_user",
    "upsert_user_link",
]
