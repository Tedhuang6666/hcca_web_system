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
from api.models.announcement import Announcement, AnnouncementAudience, announcement_audience_orgs
from api.models.discord_account import (
    DiscordAccountLink,
    DiscordGuildConfig,
    DiscordNicknamePrefixRule,
    DiscordOrgChannelMapping,
    DiscordRoleMapping,
    DiscordRoleMappingKind,
)
from api.models.document import Document, DocumentStatus, DocumentVisibility
from api.models.org import Position, UserPosition
from api.models.petition import PetitionCase
from api.models.user import User
from api.services.discord_embeds import (
    Domain,
    Severity,
    build_embed,
    default_action_row,
)
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


async def list_active_nickname_prefixes_for_user(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[str, str]:
    today = datetime.now(UTC).date()
    result = await db.execute(
        select(DiscordNicknamePrefixRule)
        .join(
            Position,
            or_(
                and_(
                    DiscordNicknamePrefixRule.mapping_kind == DiscordRoleMappingKind.POSITION,
                    DiscordNicknamePrefixRule.position_id == Position.id,
                ),
                and_(
                    DiscordNicknamePrefixRule.mapping_kind == DiscordRoleMappingKind.ORG,
                    DiscordNicknamePrefixRule.org_id == Position.org_id,
                ),
            ),
        )
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == user_id)
        .where(DiscordNicknamePrefixRule.is_active.is_(True))
        .where(*active_tenure_filter(today))
        .order_by(
            DiscordNicknamePrefixRule.priority.asc(),
            DiscordNicknamePrefixRule.updated_at.desc(),
        )
        .distinct()
    )
    rows = result.scalars().all()
    by_guild: dict[str, str] = {}
    for row in rows:
        by_guild.setdefault(row.guild_id, row.prefix)
    return by_guild


async def enqueue_role_sync(db: AsyncSession, user_id: uuid.UUID) -> None:
    from api.services.outbox import emit

    link = await get_user_link(db, user_id)
    if link is None:
        return
    desired = await list_active_role_ids_for_user(db, user_id)
    nickname_prefixes = await list_active_nickname_prefixes_for_user(db, user_id)
    mapped_rows = (
        await db.execute(select(DiscordRoleMapping.guild_id, DiscordRoleMapping.role_id))
    ).all()
    all_mapped_by_guild: dict[str, set[str]] = {}
    for guild_id, role_id in mapped_rows:
        all_mapped_by_guild.setdefault(guild_id, set()).add(role_id)
    prefix_rows = (
        await db.execute(
            select(DiscordNicknamePrefixRule.guild_id, DiscordNicknamePrefixRule.prefix).where(
                DiscordNicknamePrefixRule.is_active.is_(True)
            )
        )
    ).all()
    all_prefixes_by_guild: dict[str, set[str]] = {}
    for guild_id, prefix in prefix_rows:
        all_prefixes_by_guild.setdefault(guild_id, set()).add(prefix)
    for guild_id in sorted(set(all_mapped_by_guild) | set(all_prefixes_by_guild)):
        managed_role_ids = all_mapped_by_guild.get(guild_id, set())
        role_ids = desired.get(guild_id, set())
        await emit(
            db,
            event_type="discord.role_sync",
            payload={
                "guild_id": guild_id,
                "discord_user_id": link.discord_user_id,
                "role_ids": sorted(role_ids),
                "managed_role_ids": sorted(managed_role_ids),
                "nickname_prefix": nickname_prefixes.get(guild_id),
                "managed_nickname_prefixes": sorted(all_prefixes_by_guild.get(guild_id, set())),
            },
        )


async def get_primary_guild_config(db: AsyncSession) -> DiscordGuildConfig | None:
    guild_id = settings.DISCORD_GUILD_ID or settings.DISCORD_COMMAND_SYNC_GUILD_ID
    stmt = select(DiscordGuildConfig).where(DiscordGuildConfig.is_active.is_(True))
    if guild_id:
        stmt = stmt.where(DiscordGuildConfig.guild_id == guild_id)
    return await db.scalar(stmt.order_by(DiscordGuildConfig.updated_at.desc()).limit(1))


async def get_guild_config(db: AsyncSession, guild_id: str) -> DiscordGuildConfig | None:
    return await db.scalar(
        select(DiscordGuildConfig).where(
            DiscordGuildConfig.guild_id == guild_id,
            DiscordGuildConfig.is_active.is_(True),
        )
    )


async def emit_security_alert(db: AsyncSession, *, title: str, body: str | None = None) -> None:
    from api.services.outbox import emit

    config = await get_primary_guild_config(db)
    if config is None or not config.security_alert_channel_id:
        return
    embed = build_embed(
        Domain.SYSTEM,
        Severity.DANGER,
        title=title,
        body=body,
    )
    await emit(
        db,
        event_type="discord.channel_alert",
        payload={
            "channel_id": config.security_alert_channel_id,
            "embed": embed,
        },
    )


async def emit_moderation_log(
    db: AsyncSession, *, guild_id: str | None, title: str, body: str | None = None
) -> None:
    from api.services.outbox import emit

    config = (
        await get_guild_config(db, guild_id) if guild_id else await get_primary_guild_config(db)
    )
    if config is None or not config.moderation_log_channel_id:
        return
    embed = build_embed(
        Domain.MODERATION,
        Severity.NEUTRAL,
        title=title,
        body=body,
    )
    await emit(
        db,
        event_type="discord.channel_alert",
        payload={
            "channel_id": config.moderation_log_channel_id,
            "embed": embed,
        },
    )


async def emit_welcome_message(
    db: AsyncSession, *, guild_id: str | None, discord_user_id: str, display_name: str
) -> None:
    from api.services.outbox import emit

    config = (
        await get_guild_config(db, guild_id) if guild_id else await get_primary_guild_config(db)
    )
    if config is None or not config.welcome_channel_id:
        return
    embed = build_embed(
        Domain.SYSTEM,
        Severity.SUCCESS,
        title=f"歡迎 {display_name}",
        body=(
            f"<@{discord_user_id}> 已加入伺服器。\n"
            "若已綁定平台帳號，身分組與暱稱會自動同步；"
            "尚未綁定者可到平台個人資料頁完成連結。"
        ),
    )
    components = default_action_row(open_url="/profile", domain=Domain.SYSTEM)
    await emit(
        db,
        event_type="discord.channel_alert",
        payload={
            "channel_id": config.welcome_channel_id,
            "embed": embed,
            "components": [components] if components else None,
        },
    )


async def get_org_announcement_channel(
    db: AsyncSession, *, guild_id: str | None, org_id: uuid.UUID
) -> str | None:
    stmt = select(DiscordOrgChannelMapping).where(
        DiscordOrgChannelMapping.org_id == org_id,
        DiscordOrgChannelMapping.is_active.is_(True),
    )
    if guild_id:
        stmt = stmt.where(DiscordOrgChannelMapping.guild_id == guild_id)
    row = await db.scalar(stmt.order_by(DiscordOrgChannelMapping.updated_at.desc()).limit(1))
    return row.channel_id if row else None


async def _publication_channel_ids_for_orgs(db: AsyncSession, org_ids: set[uuid.UUID]) -> list[str]:
    config = await get_primary_guild_config(db)
    guild_id = config.guild_id if config else None
    channel_ids: list[str] = []
    for org_id in org_ids:
        channel_id = await get_org_announcement_channel(db, guild_id=guild_id, org_id=org_id)
        if channel_id and channel_id not in channel_ids:
            channel_ids.append(channel_id)
    if not channel_ids and config and config.announcement_channel_id:
        channel_ids.append(config.announcement_channel_id)
    return channel_ids


async def emit_public_document_notice(db: AsyncSession, doc: Document) -> None:
    """公開公文核准後推送到所屬機關的 Discord 公告頻道。"""
    from api.services.outbox import emit

    if doc.status != DocumentStatus.APPROVED:
        return
    if doc.visibility_level not in {DocumentVisibility.PUBLIC, DocumentVisibility.PUBLICLY_OPEN}:
        return
    channel_ids = await _publication_channel_ids_for_orgs(db, {doc.org_id})
    if not channel_ids:
        return
    link = (
        f"/public/documents/{doc.id}"
        if doc.visibility_level == DocumentVisibility.PUBLICLY_OPEN
        else f"/documents/{doc.id}"
    )
    fields: list[dict[str, Any]] = []
    if doc.serial_number:
        fields.append({"name": "字號", "value": str(doc.serial_number), "inline": True})
    body = doc.subject[:1500] if doc.subject else None
    embed = build_embed(
        Domain.DOCUMENT,
        Severity.SUCCESS,
        title=f"公開公文：{doc.title}",
        body=body,
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.DOCUMENT)
    for channel_id in channel_ids:
        await emit(
            db,
            event_type="discord.channel_alert",
            payload={
                "channel_id": channel_id,
                "embed": embed,
                "components": [components] if components else None,
                "thread_name": f"討論：{doc.title[:80]}",
            },
        )


async def emit_announcement_notice(db: AsyncSession, ann: Announcement) -> None:
    """公告發布後依所屬/指定機關推送到 Discord 公告頻道。"""
    from api.services.outbox import emit

    if not ann.is_published:
        return
    org_ids: set[uuid.UUID] = set()
    if ann.org_id:
        org_ids.add(ann.org_id)
    if ann.audience_type == AnnouncementAudience.ORGS.value:
        org_ids.update(
            (
                await db.execute(
                    select(announcement_audience_orgs.c.org_id).where(
                        announcement_audience_orgs.c.announcement_id == ann.id
                    )
                )
            )
            .scalars()
            .all()
        )
    channel_ids = await _publication_channel_ids_for_orgs(db, org_ids)
    if not channel_ids:
        return
    severity = Severity.URGENT if ann.is_urgent else Severity.INFO
    title_prefix = "【緊急】" if ann.is_urgent else "【最新】"
    embed = build_embed(
        Domain.ANNOUNCEMENT,
        severity,
        title=f"{title_prefix}{ann.title}",
        link=f"/announcements/{ann.id}",
    )
    components = default_action_row(
        open_url=f"/announcements/{ann.id}", domain=Domain.ANNOUNCEMENT
    )
    for channel_id in channel_ids:
        await emit(
            db,
            event_type="discord.channel_alert",
            payload={
                "channel_id": channel_id,
                "embed": embed,
                "components": [components] if components else None,
                "thread_name": f"留言：{ann.title[:80]}",
            },
        )


# ── Phase 1：個人 DM 與額外 domain 推播 ────────────────────────────────────────


async def emit_user_dm(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    embed: dict[str, Any],
    components: list[dict[str, Any]] | None = None,
    category: str | None = None,
) -> None:
    """個人 DM 推播。dispatcher 端會檢查 NotificationPreference 與綁定狀態。"""
    from api.services.outbox import emit

    await emit(
        db,
        event_type="discord.user_dm",
        payload={
            "user_id": str(user_id),
            "embed": embed,
            "components": components,
            "category": category,
        },
    )


def _fmt_dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")


async def _emit_org_channels(
    db: AsyncSession,
    *,
    org_ids: set[uuid.UUID],
    embed: dict[str, Any],
    components: list[dict[str, Any]] | None = None,
    thread_name: str | None = None,
) -> int:
    """共用：對一組 org 解析公告頻道並推 embed_alert。回傳實際推送頻道數。"""
    from api.services.outbox import emit

    channel_ids = await _publication_channel_ids_for_orgs(db, org_ids)
    for channel_id in channel_ids:
        await emit(
            db,
            event_type="discord.channel_alert",
            payload={
                "channel_id": channel_id,
                "embed": embed,
                "components": components,
                "thread_name": thread_name,
            },
        )
    return len(channel_ids)


# ── 會議 ──────────────────────────────────────────────────────────────────────


async def emit_meeting_invited(db: AsyncSession, meeting: Any) -> None:
    """新會議建立/發布；推 org channel + 與會者 DM（在 dispatcher 端套 preference）。"""
    fields: list[dict[str, Any]] = []
    if dt := _fmt_dt(getattr(meeting, "starts_at", None)):
        fields.append({"name": "開會時間", "value": dt, "inline": True})
    if loc := getattr(meeting, "location", None):
        fields.append({"name": "地點", "value": str(loc), "inline": True})
    if chair := getattr(meeting, "chair_name", None):
        fields.append({"name": "主席", "value": str(chair), "inline": True})
    link = f"/meetings/{meeting.id}"
    embed = build_embed(
        Domain.MEETING,
        Severity.INFO,
        title=f"開會通知：{meeting.title}",
        body=getattr(meeting, "description", None),
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.MEETING)
    components_list = [components] if components else None
    await _emit_org_channels(
        db,
        org_ids={meeting.org_id} if getattr(meeting, "org_id", None) else set(),
        embed=embed,
        components=components_list,
        thread_name=f"會議：{meeting.title[:80]}",
    )


async def emit_meeting_agenda_changed(db: AsyncSession, meeting: Any) -> None:
    link = f"/meetings/{meeting.id}"
    embed = build_embed(
        Domain.MEETING,
        Severity.WARNING,
        title=f"議程變更：{meeting.title}",
        body="議程或會議資訊已更新，請至平台檢視最新版本。",
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.MEETING)
    await _emit_org_channels(
        db,
        org_ids={meeting.org_id} if getattr(meeting, "org_id", None) else set(),
        embed=embed,
        components=[components] if components else None,
    )


async def emit_meeting_minutes_published(db: AsyncSession, meeting: Any) -> None:
    link = f"/meetings/{meeting.id}"
    embed = build_embed(
        Domain.MEETING,
        Severity.SUCCESS,
        title=f"會議紀錄發布：{meeting.title}",
        body="會議紀錄已發布，可上平台檢視全文與決議。",
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.MEETING)
    await _emit_org_channels(
        db,
        org_ids={meeting.org_id} if getattr(meeting, "org_id", None) else set(),
        embed=embed,
        components=[components] if components else None,
        thread_name=f"討論：{meeting.title[:80]}",
    )


# ── 行事曆 ────────────────────────────────────────────────────────────────────


async def emit_calendar_event_published(db: AsyncSession, event: Any) -> None:
    fields: list[dict[str, Any]] = []
    if dt := _fmt_dt(getattr(event, "starts_at", None)):
        fields.append({"name": "開始時間", "value": dt, "inline": True})
    if dt := _fmt_dt(getattr(event, "ends_at", None)):
        fields.append({"name": "結束時間", "value": dt, "inline": True})
    if loc := getattr(event, "location", None):
        fields.append({"name": "地點", "value": str(loc), "inline": True})
    link = getattr(event, "href", None) or f"/calendar/events/{event.id}"
    embed = build_embed(
        Domain.CALENDAR,
        Severity.INFO,
        title=f"新行事曆：{event.title}",
        body=getattr(event, "description", None),
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.CALENDAR)
    await _emit_org_channels(
        db,
        org_ids={event.org_id} if getattr(event, "org_id", None) else set(),
        embed=embed,
        components=[components] if components else None,
    )


async def emit_calendar_event_reminder(
    db: AsyncSession, event: Any, user_id: uuid.UUID, lead: str = "即將開始"
) -> None:
    """提醒個別參與者；dispatcher 套 preference + quiet hours。"""
    fields: list[dict[str, Any]] = []
    if dt := _fmt_dt(getattr(event, "starts_at", None)):
        fields.append({"name": "開始時間", "value": dt, "inline": True})
    if loc := getattr(event, "location", None):
        fields.append({"name": "地點", "value": str(loc), "inline": True})
    link = getattr(event, "href", None) or f"/calendar/events/{event.id}"
    embed = build_embed(
        Domain.CALENDAR,
        Severity.WARNING,
        title=f"行事曆提醒（{lead}）：{event.title}",
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.CALENDAR)
    await emit_user_dm(
        db,
        user_id=user_id,
        embed=embed,
        components=[components] if components else None,
        category="calendar_reminder",
    )


# ── 問卷 ──────────────────────────────────────────────────────────────────────


async def emit_survey_opened(
    db: AsyncSession, survey: Any, org_ids: set[uuid.UUID] | None = None
) -> None:
    link = f"/surveys/{survey.id}"
    fields: list[dict[str, Any]] = []
    if dt := _fmt_dt(getattr(survey, "closes_at", None)):
        fields.append({"name": "截止時間", "value": dt, "inline": True})
    if getattr(survey, "is_anonymous", False):
        fields.append({"name": "填答模式", "value": "匿名", "inline": True})
    embed = build_embed(
        Domain.SURVEY,
        Severity.INFO,
        title=f"問卷開放填寫：{survey.title}",
        body=getattr(survey, "description", None),
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.SURVEY)
    await _emit_org_channels(
        db,
        org_ids=org_ids or set(),
        embed=embed,
        components=[components] if components else None,
    )


async def emit_survey_closing_soon(
    db: AsyncSession, survey: Any, user_id: uuid.UUID
) -> None:
    link = f"/surveys/{survey.id}"
    fields: list[dict[str, Any]] = []
    if dt := _fmt_dt(getattr(survey, "closes_at", None)):
        fields.append({"name": "截止時間", "value": dt, "inline": True})
    embed = build_embed(
        Domain.SURVEY,
        Severity.WARNING,
        title=f"問卷即將截止：{survey.title}",
        body="你尚未填寫此問卷，請把握時間。",
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.SURVEY)
    await emit_user_dm(
        db,
        user_id=user_id,
        embed=embed,
        components=[components] if components else None,
        category="survey_closing",
    )


async def emit_survey_closed(
    db: AsyncSession, survey: Any, org_ids: set[uuid.UUID] | None = None
) -> None:
    link = f"/surveys/{survey.id}"
    embed = build_embed(
        Domain.SURVEY,
        Severity.NEUTRAL,
        title=f"問卷已截止：{survey.title}",
        body="問卷已關閉填答，可至平台檢視統計。",
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.SURVEY)
    await _emit_org_channels(
        db,
        org_ids=org_ids or set(),
        embed=embed,
        components=[components] if components else None,
    )


# ── 學餐 ──────────────────────────────────────────────────────────────────────


async def emit_meal_order_open(
    db: AsyncSession, schedule: Any, vendor_org_id: uuid.UUID, vendor_name: str
) -> None:
    fields: list[dict[str, Any]] = [
        {"name": "商家", "value": vendor_name, "inline": True},
        {"name": "供餐日期", "value": str(getattr(schedule, "date", "—")), "inline": True},
    ]
    if dt := _fmt_dt(getattr(schedule, "order_deadline", None)):
        fields.append({"name": "結單時間", "value": dt, "inline": True})
    link = f"/meal/schedules/{schedule.id}"
    embed = build_embed(
        Domain.MEAL,
        Severity.INFO,
        title=f"學餐開放訂購：{vendor_name}",
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.MEAL)
    await _emit_org_channels(
        db,
        org_ids={vendor_org_id},
        embed=embed,
        components=[components] if components else None,
    )


async def emit_meal_order_closing_soon(
    db: AsyncSession, schedule: Any, user_id: uuid.UUID, vendor_name: str
) -> None:
    link = f"/meal/schedules/{schedule.id}"
    fields: list[dict[str, Any]] = [
        {"name": "商家", "value": vendor_name, "inline": True}
    ]
    if dt := _fmt_dt(getattr(schedule, "order_deadline", None)):
        fields.append({"name": "結單時間", "value": dt, "inline": True})
    embed = build_embed(
        Domain.MEAL,
        Severity.WARNING,
        title=f"學餐即將結單：{vendor_name}",
        body="你尚未訂購此排程的學餐，請把握時間結單前下單。",
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.MEAL)
    await emit_user_dm(
        db,
        user_id=user_id,
        embed=embed,
        components=[components] if components else None,
        category="meal_closing",
    )


async def emit_meal_order_closed(
    db: AsyncSession, schedule: Any, vendor_org_id: uuid.UUID, vendor_name: str, order_count: int
) -> None:
    link = f"/meal/schedules/{schedule.id}"
    embed = build_embed(
        Domain.MEAL,
        Severity.NEUTRAL,
        title=f"學餐結單：{vendor_name}",
        body=f"本次共 {order_count} 筆訂單，承辦人請至平台確認備餐與取餐安排。",
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.MEAL)
    await _emit_org_channels(
        db,
        org_ids={vendor_org_id},
        embed=embed,
        components=[components] if components else None,
    )


# ── 福利社 ────────────────────────────────────────────────────────────────────


async def emit_shop_item_listed(db: AsyncSession, product: Any) -> None:
    fields: list[dict[str, Any]] = []
    if price := getattr(product, "price", None):
        fields.append({"name": "售價", "value": f"NT$ {price}", "inline": True})
    if dt := _fmt_dt(getattr(product, "sale_end", None)):
        fields.append({"name": "截止時間", "value": dt, "inline": True})
    link = f"/shop/products/{product.id}"
    embed = build_embed(
        Domain.SHOP,
        Severity.INFO,
        title=f"新商品上架：{product.name}",
        body=getattr(product, "description", None),
        fields=fields,
        link=link,
        thumbnail_url=getattr(product, "image_url", None),
    )
    components = default_action_row(open_url=link, domain=Domain.SHOP)
    await _emit_org_channels(
        db,
        org_ids={product.org_id} if getattr(product, "org_id", None) else set(),
        embed=embed,
        components=[components] if components else None,
    )


async def emit_shop_order_ready(
    db: AsyncSession, order: Any, *, user_id: uuid.UUID
) -> None:
    link = f"/shop/orders/{order.id}"
    fields: list[dict[str, Any]] = []
    if serial := getattr(order, "serial_number", None):
        fields.append({"name": "訂單字號", "value": str(serial), "inline": True})
    embed = build_embed(
        Domain.SHOP,
        Severity.SUCCESS,
        title="商品可取貨",
        body="你訂購的商品已備齊，請依公告地點取貨。",
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.SHOP)
    await emit_user_dm(
        db,
        user_id=user_id,
        embed=embed,
        components=[components] if components else None,
        category="shop_ready",
    )


# ── 法規 ──────────────────────────────────────────────────────────────────────


async def emit_regulation_workflow_changed(
    db: AsyncSession, regulation: Any, *, from_status: str | None = None
) -> None:
    fields: list[dict[str, Any]] = [
        {"name": "目前狀態", "value": str(regulation.workflow_status), "inline": True}
    ]
    if from_status:
        fields.insert(0, {"name": "原狀態", "value": from_status, "inline": True})
    link = f"/regulations/{regulation.id}"
    embed = build_embed(
        Domain.REGULATION,
        Severity.INFO,
        title=f"法規流程更新：{regulation.title}",
        body=getattr(regulation, "workflow_note", None),
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.REGULATION)
    await _emit_org_channels(
        db,
        org_ids={regulation.org_id} if getattr(regulation, "org_id", None) else set(),
        embed=embed,
        components=[components] if components else None,
    )


async def emit_regulation_published(db: AsyncSession, regulation: Any) -> None:
    fields: list[dict[str, Any]] = [
        {"name": "版本", "value": str(getattr(regulation, "version", 1)), "inline": True}
    ]
    if dt := _fmt_dt(getattr(regulation, "effective_date", None)):
        fields.append({"name": "生效日期", "value": dt, "inline": True})
    link = f"/regulations/{regulation.id}"
    embed = build_embed(
        Domain.REGULATION,
        Severity.SUCCESS,
        title=f"法規公布：{regulation.title}",
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.REGULATION)
    await _emit_org_channels(
        db,
        org_ids={regulation.org_id} if getattr(regulation, "org_id", None) else set(),
        embed=embed,
        components=[components] if components else None,
        thread_name=f"討論：{regulation.title[:80]}",
    )


# ── 公文：個人待簽核 DM ───────────────────────────────────────────────────────


async def emit_document_pending_to_approver(
    db: AsyncSession, document: Any, approver_user_id: uuid.UUID
) -> None:
    fields: list[dict[str, Any]] = []
    if serial := getattr(document, "serial_number", None):
        fields.append({"name": "字號", "value": str(serial), "inline": True})
    if subject := getattr(document, "subject", None):
        fields.append({"name": "主旨", "value": str(subject)[:1000], "inline": False})
    link = f"/documents/{document.id}"
    embed = build_embed(
        Domain.DOCUMENT,
        Severity.INFO,
        title=f"公文待你核稿：{document.title}",
        fields=fields,
        link=link,
    )
    components = default_action_row(open_url=link, domain=Domain.DOCUMENT)
    await emit_user_dm(
        db,
        user_id=approver_user_id,
        embed=embed,
        components=[components] if components else None,
        category="document_pending",
    )


# ── 任期 ──────────────────────────────────────────────────────────────────────


async def emit_tenure_started(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    user_display_name: str,
    org_id: uuid.UUID | None,
    org_name: str,
    position_name: str,
) -> None:
    body = f"{user_display_name} 即日起出任 {org_name} 的「{position_name}」。"
    embed = build_embed(
        Domain.TENURE,
        Severity.SUCCESS,
        title=f"任期開始：{position_name}",
        body=body,
    )
    org_ids = {org_id} if org_id else set()
    components = default_action_row(open_url=f"/orgs/{org_id}" if org_id else None)
    await _emit_org_channels(
        db,
        org_ids=org_ids,
        embed=embed,
        components=[components] if components else None,
    )
    await emit_user_dm(
        db,
        user_id=user_id,
        embed=build_embed(
            Domain.TENURE,
            Severity.SUCCESS,
            title=f"你的任期已生效：{position_name}",
            body=body,
        ),
        category="tenure",
    )


async def emit_tenure_ended(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    user_display_name: str,
    org_id: uuid.UUID | None,
    org_name: str,
    position_name: str,
) -> None:
    body = f"{user_display_name} 於 {org_name} 的「{position_name}」任期已結束。"
    embed = build_embed(
        Domain.TENURE,
        Severity.NEUTRAL,
        title=f"任期結束：{position_name}",
        body=body,
    )
    org_ids = {org_id} if org_id else set()
    components = default_action_row(open_url=f"/orgs/{org_id}" if org_id else None)
    await _emit_org_channels(
        db,
        org_ids=org_ids,
        embed=embed,
        components=[components] if components else None,
    )
    await emit_user_dm(
        db,
        user_id=user_id,
        embed=build_embed(
            Domain.TENURE,
            Severity.NEUTRAL,
            title=f"你的任期已結束：{position_name}",
            body=body,
        ),
        category="tenure",
    )


def _discord_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bot {settings.DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json",
    }


def _sanitize_channel_name(value: str) -> str:
    allowed = []
    for char in value.lower():
        if char.isalnum() or char in {"-", "_"}:
            allowed.append(char)
        elif char.isspace():
            allowed.append("-")
    name = "".join(allowed).strip("-")
    return name[:80] or "petition"


async def enqueue_petition_private_channel(
    db: AsyncSession, case_obj: PetitionCase, *, force: bool = False
) -> bool:
    from api.services.outbox import emit

    if case_obj.discord_channel_id and not force:
        return False
    config = await get_primary_guild_config(db)
    if (
        config is None
        or not config.petition_private_channel_enabled
        or not config.petition_staff_role_id
    ):
        return False
    submitter_link = await get_user_link(db, case_obj.submitter_id) if case_obj.submitter_id else None
    await emit(
        db,
        event_type="discord.petition_channel_create",
        payload={
            "case_id": str(case_obj.id),
            "case_number": case_obj.case_number,
            "title": case_obj.title,
            "guild_id": config.guild_id,
            "category_id": config.petition_private_category_id,
            "staff_role_id": config.petition_staff_role_id,
            "submitter_discord_user_id": submitter_link.discord_user_id if submitter_link else None,
            "is_named": case_obj.is_named,
        },
    )
    return True


def create_petition_private_channel(payload: dict[str, Any]) -> str | None:
    if not bot_configured():
        logger.warning("Discord Bot 未設定，跳過陳情私密頻道建立")
        return None
    guild_id = str(payload["guild_id"])
    case_id = str(payload["case_id"])
    case_number = str(payload.get("case_number") or case_id[:8])
    title = str(payload.get("title") or "陳情案件")
    staff_role_id = str(payload["staff_role_id"])
    submitter_id = payload.get("submitter_discord_user_id")

    view_channel = 1 << 10
    send_messages = 1 << 11
    manage_messages = 1 << 13
    attach_files = 1 << 15
    read_history = 1 << 16
    petitioner_allow = view_channel | send_messages | attach_files | read_history
    staff_allow = petitioner_allow | manage_messages
    overwrites: list[dict[str, Any]] = [
        {"id": guild_id, "type": 0, "deny": str(view_channel), "allow": "0"},
        {"id": staff_role_id, "type": 0, "allow": str(staff_allow), "deny": "0"},
    ]
    if submitter_id:
        overwrites.append(
            {"id": str(submitter_id), "type": 1, "allow": str(petitioner_allow), "deny": "0"}
        )
    body: dict[str, Any] = {
        "name": _sanitize_channel_name(f"petition-{case_number}-{title[:24]}"),
        "type": 0,
        "topic": f"HCCA 陳情案件 {case_number}。正式長文與附件請回平台處理。",
        "permission_overwrites": overwrites,
    }
    if payload.get("category_id"):
        body["parent_id"] = str(payload["category_id"])
    with httpx.Client(timeout=10.0, headers=_discord_headers()) as client:
        created = client.post(f"https://discord.com/api/v10/guilds/{guild_id}/channels", json=body)
        created.raise_for_status()
        channel = created.json()
        channel_id = str(channel["id"])
        intro = (
            f"陳情案件 {case_number} 已建立私密討論頻道。\n"
            f"案件：{title}\n"
            f"{'<@' + str(submitter_id) + '> ' if submitter_id else ''}"
            "這裡適合快速補充與溝通；正式回覆、附件與結案仍會保存到平台。"
        )
        message = client.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            json={"content": intro[:1900]},
        )
        message.raise_for_status()

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from api.core.config import settings

    sync_url = settings.DATABASE_URL.replace("+asyncpg", "")
    engine = create_engine(sync_url)
    with Session(engine) as session:
        case_obj = session.get(PetitionCase, uuid.UUID(case_id))
        if case_obj is not None:
            case_obj.discord_guild_id = guild_id
            case_obj.discord_channel_id = channel_id
            case_obj.discord_channel_created_at = datetime.now(UTC)
            session.commit()
    return channel_id


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


async def fetch_bot_user() -> dict[str, Any] | None:
    if not bot_configured():
        return None
    async with httpx.AsyncClient(timeout=10.0, headers=_discord_headers()) as client:
        res = await client.get("https://discord.com/api/v10/users/@me")
        res.raise_for_status()
        return dict(res.json())


async def fetch_guild_member(guild_id: str, discord_user_id: str) -> dict[str, Any] | None:
    if not bot_configured():
        return None
    async with httpx.AsyncClient(timeout=10.0, headers=_discord_headers()) as client:
        res = await client.get(
            f"https://discord.com/api/v10/guilds/{guild_id}/members/{discord_user_id}"
        )
        if res.status_code == 404:
            return None
        res.raise_for_status()
        return dict(res.json())


async def bot_health_snapshot(db: AsyncSession) -> dict[str, Any]:
    bot_user = await fetch_bot_user()
    configs = (await db.execute(select(DiscordGuildConfig))).scalars().all()
    active_links = await db.scalar(
        select(DiscordAccountLink).where(DiscordAccountLink.is_active.is_(True)).limit(1)
    )
    return {
        "bot_configured": bot_configured(),
        "oauth_configured": is_configured(),
        "bot_user_id": str(bot_user.get("id")) if bot_user else None,
        "bot_username": str(bot_user.get("username")) if bot_user else None,
        "configured_guild_count": len(configs),
        "has_active_links": active_links is not None,
    }


async def enqueue_all_role_sync(db: AsyncSession) -> int:
    user_ids = (
        await db.execute(
            select(DiscordAccountLink.user_id).where(DiscordAccountLink.is_active.is_(True))
        )
    ).scalars()
    count = 0
    for user_id in user_ids:
        await enqueue_role_sync(db, user_id)
        count += 1
    return count


def send_dm(
    discord_user_id: str,
    *,
    title: str | None = None,
    body: str | None = None,
    link: str | None = None,
    embed: dict[str, Any] | None = None,
    components: list[dict[str, Any]] | None = None,
) -> None:
    if not bot_configured():
        logger.warning("Discord Bot 未設定，跳過 DM")
        return
    payload: dict[str, Any] = {}
    if embed is not None:
        payload["embeds"] = [embed]
    else:
        text = title or "HCCA 平台通知"
        if body:
            text = f"{text}\n{body}"
        if link:
            text = f"{text}\n{_absolute_url(link)}"
        payload["content"] = text[:1900]
    if components:
        payload["components"] = components
    with httpx.Client(timeout=10.0, headers=_discord_headers()) as client:
        channel = client.post(
            "https://discord.com/api/v10/users/@me/channels",
            json={"recipient_id": discord_user_id},
        )
        channel.raise_for_status()
        channel_id = channel.json()["id"]
        message = client.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            json=payload,
        )
        message.raise_for_status()


def send_channel_message(
    channel_id: str,
    *,
    title: str | None = None,
    body: str | None = None,
    embed: dict[str, Any] | None = None,
    components: list[dict[str, Any]] | None = None,
    thread_name: str | None = None,
) -> None:
    if not bot_configured():
        logger.warning("Discord Bot 未設定，跳過頻道訊息")
        return
    payload: dict[str, Any] = {}
    if embed is not None:
        payload["embeds"] = [embed]
    else:
        content = (title or "") if body is None else f"{title or ''}\n{body}".strip()
        payload["content"] = content[:1900]
    if components:
        payload["components"] = components
    with httpx.Client(timeout=10.0, headers=_discord_headers()) as client:
        res = client.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            json=payload,
        )
        res.raise_for_status()
        if thread_name:
            message_id = str(res.json().get("id") or "")
            if message_id:
                thread_res = client.post(
                    f"https://discord.com/api/v10/channels/{channel_id}/messages/{message_id}/threads",
                    json={
                        "name": thread_name[:100],
                        "auto_archive_duration": 1440,
                    },
                )
                if thread_res.status_code >= 400:
                    logger.warning(
                        "Discord 自動開 thread 失敗 channel=%s message=%s status=%s",
                        channel_id,
                        message_id,
                        thread_res.status_code,
                    )


def _strip_managed_prefix(name: str, prefixes: list[str]) -> str:
    value = name.strip()
    for prefix in sorted((p.strip() for p in prefixes if p.strip()), key=len, reverse=True):
        if value.startswith(prefix):
            return value[len(prefix) :].strip()
    return value


def _with_prefix(base_name: str, prefix: str | None) -> str:
    name = base_name.strip() or "HCCA"
    value = f"{prefix.strip()}{name}" if prefix else name
    return value[:32]


def sync_member_roles(
    guild_id: str,
    discord_user_id: str,
    role_ids: list[str],
    managed_role_ids: list[str] | None = None,
    nickname_prefix: str | None = None,
    managed_nickname_prefixes: list[str] | None = None,
) -> None:
    if not bot_configured():
        logger.warning("Discord Bot 未設定，跳過角色同步")
        return
    with httpx.Client(timeout=10.0, headers=_discord_headers()) as client:
        member_payload: dict[str, Any] | None = None
        if managed_role_ids is not None:
            member = client.get(
                f"https://discord.com/api/v10/guilds/{guild_id}/members/{discord_user_id}"
            )
            member.raise_for_status()
            member_payload = member.json()
            current_roles = set(member_payload.get("roles") or [])
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
        if managed_nickname_prefixes is not None:
            if member_payload is None:
                member = client.get(
                    f"https://discord.com/api/v10/guilds/{guild_id}/members/{discord_user_id}"
                )
                member.raise_for_status()
                member_payload = member.json()
            user_payload = member_payload.get("user") or {}
            current_name = (
                member_payload.get("nick")
                or user_payload.get("global_name")
                or user_payload.get("username")
                or "HCCA"
            )
            base_name = _strip_managed_prefix(str(current_name), managed_nickname_prefixes)
            desired_nick = _with_prefix(base_name, nickname_prefix)
            if desired_nick != member_payload.get("nick"):
                res = client.patch(
                    f"https://discord.com/api/v10/guilds/{guild_id}/members/{discord_user_id}",
                    json={"nick": desired_nick},
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


def _user_dm_allowed(session: Any, user_id: uuid.UUID, category: str | None) -> bool:
    """檢查使用者 NotificationPreference 是否允許此 category；未綁 preference 預設 True。

    Phase 1.4 之後 DiscordNotificationPreference 表存在；此函式同時相容
    表尚未建立的情境（catch ProgrammingError 視為允許）。
    """
    if not category:
        return True
    try:
        from sqlalchemy import select as _select

        from api.models.discord_account import DiscordNotificationPreference

        pref = session.execute(
            _select(DiscordNotificationPreference).where(
                DiscordNotificationPreference.user_id == user_id
            )
        ).scalar_one_or_none()
        if pref is None:
            return True
        prefs = pref.preferences or {}
        return bool(prefs.get(category, True))
    except ImportError:
        return True
    except Exception as exc:
        logger.debug("讀取 DM preference 失敗，預設允許：%s", exc)
        return True


def dispatch_user_dm(payload: dict[str, Any]) -> None:
    """Celery 端 user_dm 分派：解析平台 user_id → DiscordAccountLink → send_dm。

    payload schema:
        - user_id: str(UUID) 必填
        - embed: dict 必填（純文字 DM 直接走舊 discord.push）
        - components: list[dict] 可選
        - category: str 可選；若帶入會查 NotificationPreference 是否允許
    """
    user_id_str = payload.get("user_id")
    embed = payload.get("embed")
    components = payload.get("components")
    category = payload.get("category")
    if not user_id_str or embed is None:
        logger.warning("discord.user_dm payload 缺 user_id 或 embed")
        return
    try:
        user_uuid = uuid.UUID(str(user_id_str))
    except (TypeError, ValueError):
        logger.warning("discord.user_dm user_id 非合法 UUID：%s", user_id_str)
        return

    from sqlalchemy import create_engine, select as _select
    from sqlalchemy.orm import Session

    sync_url = settings.DATABASE_URL.replace("+asyncpg", "")
    eng = create_engine(sync_url)
    with Session(eng) as session:
        link = session.execute(
            _select(DiscordAccountLink).where(
                DiscordAccountLink.user_id == user_uuid,
                DiscordAccountLink.is_active.is_(True),
            )
        ).scalar_one_or_none()
        if link is None:
            logger.info("Discord DM 略過：使用者 %s 未綁定", user_uuid)
            return
        if not _user_dm_allowed(session, user_uuid, category):
            logger.info(
                "Discord DM 略過：user=%s category=%s 已關閉", user_uuid, category
            )
            return
        discord_user_id = link.discord_user_id

    send_dm(str(discord_user_id), embed=embed, components=components)


__all__ = [
    "bot_configured",
    "consume_open_token",
    "create_open_url",
    "create_petition_private_channel",
    "dispatch_user_dm",
    "emit_announcement_notice",
    "emit_calendar_event_published",
    "emit_calendar_event_reminder",
    "emit_document_pending_to_approver",
    "emit_meal_order_closed",
    "emit_meal_order_closing_soon",
    "emit_meal_order_open",
    "emit_meeting_agenda_changed",
    "emit_meeting_invited",
    "emit_meeting_minutes_published",
    "emit_moderation_log",
    "emit_public_document_notice",
    "emit_regulation_published",
    "emit_regulation_workflow_changed",
    "emit_security_alert",
    "emit_shop_item_listed",
    "emit_shop_order_ready",
    "emit_survey_closed",
    "emit_survey_closing_soon",
    "emit_survey_opened",
    "emit_tenure_ended",
    "emit_tenure_started",
    "emit_user_dm",
    "emit_welcome_message",
    "enqueue_all_role_sync",
    "enqueue_petition_private_channel",
    "enqueue_role_sync",
    "bot_health_snapshot",
    "format_discord_payload",
    "fetch_bot_user",
    "fetch_bot_guilds",
    "fetch_guild_channels",
    "fetch_guild_member",
    "fetch_guild_roles",
    "get_guild_config",
    "get_primary_guild_config",
    "get_org_announcement_channel",
    "list_active_nickname_prefixes_for_user",
    "get_user_by_discord_id",
    "get_user_link",
    "is_configured",
    "send_channel_message",
    "send_dm",
    "sync_member_roles",
    "unlink_user",
    "upsert_user_link",
]
