"""Discord 模組通知路由：依事件與資源條件產生 channel outbox 事件。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.discord_notification_route import DiscordNotificationRoute
from api.services.discord_embeds import (
    Domain,
    EmbedField,
    Severity,
    build_embed,
    default_action_row,
)
from api.services.outbox import emit

EVENT_CATALOG: tuple[dict[str, str], ...] = (
    {"key": "merchandise_submission.submitted", "module": "shop", "label": "校商投稿送出"},
    {"key": "merchandise_submission.reviewed", "module": "shop", "label": "校商投稿審核完成"},
    {"key": "petition.created", "module": "petition", "label": "陳情建立"},
    {"key": "petition.assigned", "module": "petition", "label": "陳情指派"},
    {"key": "petition.status_changed", "module": "petition", "label": "陳情狀態更新"},
    {"key": "petition.replied", "module": "petition", "label": "陳情回覆"},
    {"key": "document.published", "module": "document", "label": "公文發布"},
    {"key": "announcement.published", "module": "announcement", "label": "公告發布"},
    {"key": "regulation.published", "module": "regulation", "label": "法規發布"},
)

_DOMAIN_BY_MODULE: dict[str, Domain] = {
    "shop": Domain.SHOP,
    "petition": Domain.PETITION,
    "document": Domain.DOCUMENT,
    "announcement": Domain.ANNOUNCEMENT,
    "regulation": Domain.REGULATION,
}


def list_event_catalog() -> list[dict[str, str]]:
    """回傳管理端可選的事件清單。"""
    return [dict(item) for item in EVENT_CATALOG]


async def emit_routed_notification(
    db: AsyncSession,
    *,
    event_key: str,
    module: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    fields: list[EmbedField] | None = None,
    severity: Severity = Severity.INFO,
    petition_type_id: uuid.UUID | None = None,
    org_id: uuid.UUID | None = None,
    thread_name: str | None = None,
) -> int:
    """依已啟用規則將一則模組事件排入 Discord outbox。"""
    result = await db.execute(
        select(DiscordNotificationRoute)
        .where(
            DiscordNotificationRoute.event_key == event_key,
            DiscordNotificationRoute.is_active.is_(True),
        )
        .order_by(DiscordNotificationRoute.priority, DiscordNotificationRoute.created_at)
    )
    routes = result.scalars().all()
    if not routes:
        return 0

    embed = build_embed(
        _DOMAIN_BY_MODULE.get(module, Domain.SYSTEM),
        severity,
        title=title,
        body=body,
        fields=fields,
        link=link,
    )
    components = default_action_row(
        open_url=link, domain=_DOMAIN_BY_MODULE.get(module, Domain.SYSTEM)
    )
    sent = 0
    for route in routes:
        if route.petition_type_id and route.petition_type_id != petition_type_id:
            continue
        if route.org_id and route.org_id != org_id:
            continue
        content = f"<@&{route.role_id}>" if route.role_id and route.mention_role else None
        await emit(
            db,
            event_type="discord.channel_alert",
            payload={
                "guild_id": route.guild_id,
                "channel_id": route.channel_id,
                "content": content,
                "embed": embed,
                "components": [components] if components else None,
                "thread_name": thread_name,
                "event_key": event_key,
            },
        )
        sent += 1
    return sent


async def emit_personal_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    notification_type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> None:
    """把平台個人通知轉成統一的 Discord DM outbox 事件。"""
    from api.services.discord_bot import emit_user_dm

    embed = build_embed(Domain.SYSTEM, Severity.INFO, title=title, body=body, link=link)
    components = default_action_row(open_url=link, domain=Domain.SYSTEM)
    await emit_user_dm(
        db,
        user_id=user_id,
        embed=embed,
        components=[components] if components else None,
        category=notification_type,
    )


__all__ = [
    "EVENT_CATALOG",
    "emit_personal_notification",
    "emit_routed_notification",
    "list_event_catalog",
]
