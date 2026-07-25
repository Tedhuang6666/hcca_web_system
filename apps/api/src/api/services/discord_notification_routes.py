"""Discord 模組通知路由：依事件與資源條件產生 channel outbox 事件。"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

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


def build_merchandise_submission_fields(
    *,
    custom_fields: list[dict[str, Any]],
    field_values: Mapping[str, str],
    account_snapshot: Mapping[str, str],
    filenames: list[str],
) -> list[EmbedField]:
    """把校商投稿表單值轉成可直接審核的 Discord 欄位。"""
    fields: list[EmbedField] = []
    account_lines = [
        f"姓名：{account_snapshot.get('display_name') or '—'}",
        f"學校信箱：{account_snapshot.get('email') or '—'}",
    ]
    if account_snapshot.get("student_id"):
        account_lines.append(f"學號：{account_snapshot['student_id']}")
    fields.append({"name": "投稿者", "value": "\n".join(account_lines)})

    configured_keys: set[str] = set()
    for definition in custom_fields:
        key = str(definition.get("key") or "")
        if not key:
            continue
        configured_keys.add(key)
        fields.append(
            {
                "name": str(definition.get("label") or key),
                "value": field_values.get(key, "").strip() or "（未填寫）",
            }
        )

    for key, value in field_values.items():
        if key not in configured_keys:
            fields.append({"name": key, "value": value.strip() or "（未填寫）"})

    if filenames:
        fields.append({"name": "投稿檔案", "value": "\n".join(f"• {name}" for name in filenames)})
    return fields


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
    image_urls: list[str] | None = None,
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

    domain = _DOMAIN_BY_MODULE.get(module, Domain.SYSTEM)
    urls = [url for url in (image_urls or []) if url][:4]
    embeds = [
        build_embed(
            domain,
            severity,
            title=title,
            body=body,
            fields=fields,
            link=link,
            image_url=urls[0] if urls else None,
        )
    ]
    for index, image_url in enumerate(urls[1:], start=2):
        embeds.append(
            build_embed(
                domain,
                severity,
                title=f"{title}｜圖片 {index}",
                link=link,
                image_url=image_url,
            )
        )
    embed = embeds[0]
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
        payload: dict[str, Any] = {
            "guild_id": route.guild_id,
            "channel_id": route.channel_id,
            "content": content,
            "embed": embed,
            "components": [components] if components else None,
            "thread_name": thread_name,
            "event_key": event_key,
        }
        if len(embeds) > 1:
            payload["embeds"] = embeds
        await emit(
            db,
            event_type="discord.channel_alert",
            payload=payload,
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
    "build_merchandise_submission_fields",
    "emit_personal_notification",
    "emit_routed_notification",
    "list_event_catalog",
]
