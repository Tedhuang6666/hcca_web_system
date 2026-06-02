"""Discord embed 統一組裝模組。

所有送往 Discord 的訊息（embed_alert / user_dm / moderation log / digest 等）
都應透過此模組組 embed dict，確保視覺語言一致；同時為 outbox payload 提供
JSON-serializable 的純 dict 輸出，相容 sync httpx dispatcher。
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, TypedDict

from api.core.config import settings

# Discord embed 欄位上限（依官方 API）。
_TITLE_MAX = 256
_DESCRIPTION_MAX = 4096
_FIELD_NAME_MAX = 256
_FIELD_VALUE_MAX = 1024
_FOOTER_MAX = 2048
_AUTHOR_NAME_MAX = 256
_FIELDS_MAX = 25
_TOTAL_MAX = 6000  # embed 內所有文字加總上限

# Discord button style 編號
_BUTTON_STYLE_LINK = 5
_BUTTON_STYLE_SECONDARY = 2
_COMPONENT_TYPE_ACTION_ROW = 1
_COMPONENT_TYPE_BUTTON = 2


class Severity(StrEnum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    DANGER = "danger"
    URGENT = "urgent"
    NEUTRAL = "neutral"


class Domain(StrEnum):
    DOCUMENT = "document"
    ANNOUNCEMENT = "announcement"
    PETITION = "petition"
    MEETING = "meeting"
    CALENDAR = "calendar"
    SURVEY = "survey"
    MEAL = "meal"
    SHOP = "shop"
    REGULATION = "regulation"
    TASK = "task"
    TENURE = "tenure"
    SYSTEM = "system"
    MODERATION = "moderation"


_SEVERITY_COLOR: dict[Severity, int] = {
    Severity.INFO: 0x5865F2,
    Severity.SUCCESS: 0x57F287,
    Severity.WARNING: 0xFEE75C,
    Severity.DANGER: 0xED4245,
    Severity.URGENT: 0xEB459E,
    Severity.NEUTRAL: 0x99AAB5,
}


_DOMAIN_EMOJI: dict[Domain, str] = {
    Domain.DOCUMENT: "📄",
    Domain.ANNOUNCEMENT: "📢",
    Domain.PETITION: "🗳️",
    Domain.MEETING: "🤝",
    Domain.CALENDAR: "📅",
    Domain.SURVEY: "📝",
    Domain.MEAL: "🍱",
    Domain.SHOP: "🛒",
    Domain.REGULATION: "⚖️",
    Domain.TASK: "✅",
    Domain.TENURE: "👤",
    Domain.SYSTEM: "⚙️",
    Domain.MODERATION: "🛡️",
}


_DOMAIN_LABEL: dict[Domain, str] = {
    Domain.DOCUMENT: "公文",
    Domain.ANNOUNCEMENT: "公告",
    Domain.PETITION: "陳情",
    Domain.MEETING: "會議",
    Domain.CALENDAR: "行事曆",
    Domain.SURVEY: "問卷",
    Domain.MEAL: "學餐",
    Domain.SHOP: "福利社",
    Domain.REGULATION: "法規",
    Domain.TASK: "待辦",
    Domain.TENURE: "任期",
    Domain.SYSTEM: "系統",
    Domain.MODERATION: "管理",
}


class EmbedField(TypedDict, total=False):
    name: str
    value: str
    inline: bool


def _truncate(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    if len(text) <= limit:
        return text
    if limit <= 1:
        return text[:limit]
    return text[: limit - 1] + "…"


def _absolute_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith(("http://", "https://")):
        return path
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    return f"{base}{path if path.startswith('/') else '/' + path}"


def severity_color(severity: Severity | str) -> int:
    if isinstance(severity, str) and not isinstance(severity, Severity):
        try:
            severity = Severity(severity)
        except ValueError:
            severity = Severity.INFO
    return _SEVERITY_COLOR[severity]


def domain_emoji(domain: Domain | str) -> str:
    if isinstance(domain, str) and not isinstance(domain, Domain):
        try:
            domain = Domain(domain)
        except ValueError:
            return "🔔"
    return _DOMAIN_EMOJI[domain]


def domain_label(domain: Domain | str) -> str:
    if isinstance(domain, str) and not isinstance(domain, Domain):
        try:
            domain = Domain(domain)
        except ValueError:
            return "通知"
    return _DOMAIN_LABEL[domain]


def build_embed(
    domain: Domain | str,
    severity: Severity | str = Severity.INFO,
    *,
    title: str,
    body: str | None = None,
    fields: list[EmbedField] | None = None,
    link: str | None = None,
    footer: str | None = None,
    timestamp: datetime | None = None,
    author_name: str | None = None,
    author_icon_url: str | None = None,
    thumbnail_url: str | None = None,
) -> dict[str, Any]:
    """組裝 Discord embed dict。輸出可直接放進 outbox payload 或 REST API。"""
    dom = domain if isinstance(domain, Domain) else Domain(domain)
    sev = severity if isinstance(severity, Severity) else Severity(severity)
    emoji = _DOMAIN_EMOJI[dom]
    label = _DOMAIN_LABEL[dom]

    raw_title = title if title.startswith(emoji) else f"{emoji} {title}"
    embed: dict[str, Any] = {
        "title": _truncate(raw_title, _TITLE_MAX),
        "color": _SEVERITY_COLOR[sev],
        "timestamp": (timestamp or datetime.now(UTC)).isoformat(),
    }

    if body:
        embed["description"] = _truncate(body, _DESCRIPTION_MAX)

    if link:
        url = _absolute_url(link)
        if url:
            embed["url"] = url

    if fields:
        truncated_fields: list[dict[str, Any]] = []
        for field in fields[:_FIELDS_MAX]:
            name = _truncate(field.get("name", "—"), _FIELD_NAME_MAX) or "—"
            value = _truncate(field.get("value", "—"), _FIELD_VALUE_MAX) or "—"
            entry: dict[str, Any] = {"name": name, "value": value}
            if field.get("inline"):
                entry["inline"] = True
            truncated_fields.append(entry)
        embed["fields"] = truncated_fields

    footer_text = footer or f"HCCA · {label} · {settings.ENVIRONMENT}"
    embed["footer"] = {"text": _truncate(footer_text, _FOOTER_MAX)}

    if author_name:
        author: dict[str, Any] = {"name": _truncate(author_name, _AUTHOR_NAME_MAX)}
        if author_icon_url:
            author["icon_url"] = author_icon_url
        embed["author"] = author

    if thumbnail_url:
        embed["thumbnail"] = {"url": thumbnail_url}

    _enforce_total_limit(embed)
    return embed


def _embed_total_chars(embed: dict[str, Any]) -> int:
    total = sum(len(str(embed.get(key) or "")) for key in ("title", "description"))
    total += len(str((embed.get("footer") or {}).get("text") or ""))
    total += len(str((embed.get("author") or {}).get("name") or ""))
    for field in embed.get("fields") or []:
        total += len(str(field.get("name") or "")) + len(str(field.get("value") or ""))
    return total


def _enforce_total_limit(embed: dict[str, Any]) -> None:
    """確保 embed 文字總和不超過 6000 字（Discord 上限）。

    優先順序：先砍 description；仍超過再從 fields 尾端 pop；最後對最後一個 field
    的 value 做截斷。author/title/footer/timestamp 不動。
    """
    total = _embed_total_chars(embed)
    if total <= _TOTAL_MAX:
        return
    overflow = total - _TOTAL_MAX
    desc = embed.get("description")
    if desc:
        new_len = max(0, len(desc) - overflow - 1)
        embed["description"] = desc[:new_len] + "…" if new_len > 0 else ""
        total = _embed_total_chars(embed)
        if total <= _TOTAL_MAX:
            return
    fields = embed.get("fields") or []
    while fields and _embed_total_chars(embed) > _TOTAL_MAX:
        fields.pop()
    if fields and _embed_total_chars(embed) > _TOTAL_MAX:
        last = fields[-1]
        overflow = _embed_total_chars(embed) - _TOTAL_MAX
        value = last.get("value") or ""
        new_len = max(0, len(value) - overflow - 1)
        last["value"] = value[:new_len] + "…" if new_len > 0 else "…"


def link_button(label: str, url: str, *, emoji: str | None = None) -> dict[str, Any]:
    button: dict[str, Any] = {
        "type": _COMPONENT_TYPE_BUTTON,
        "style": _BUTTON_STYLE_LINK,
        "label": _truncate(label, 80) or "查看",
        "url": url,
    }
    if emoji:
        button["emoji"] = {"name": emoji}
    return button


def action_row(*buttons: dict[str, Any]) -> dict[str, Any]:
    if not buttons:
        return {"type": _COMPONENT_TYPE_ACTION_ROW, "components": []}
    return {
        "type": _COMPONENT_TYPE_ACTION_ROW,
        "components": list(buttons[:5]),  # Discord 限制 1 row ≤ 5 按鈕
    }


def default_action_row(
    *,
    open_url: str | None,
    domain: Domain | str | None = None,
    extra_buttons: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """所有 embed 通知的標準按鈕列：打開平台 + 額外按鈕。

    `open_url` 應為 `create_open_url()` 產生的短效登入 URL，或主站 path
    （會自動補 FRONTEND_BASE_URL）。沒有任何按鈕時回 None。
    """
    buttons: list[dict[str, Any]] = []
    if open_url:
        abs_url = _absolute_url(open_url) or open_url
        emoji = domain_emoji(domain) if domain else None
        buttons.append(link_button("打開平台", abs_url, emoji=emoji))
    if extra_buttons:
        buttons.extend(extra_buttons)
    if not buttons:
        return None
    return action_row(*buttons)


__all__ = [
    "Domain",
    "EmbedField",
    "Severity",
    "action_row",
    "build_embed",
    "default_action_row",
    "domain_emoji",
    "domain_label",
    "link_button",
    "severity_color",
]
