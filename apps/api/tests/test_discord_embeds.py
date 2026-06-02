"""Discord embed 組裝模組單元測試。

只測純函式，不需 DB / event loop。
"""

from __future__ import annotations

from datetime import UTC, datetime

from api.services.discord_embeds import (
    Domain,
    Severity,
    action_row,
    build_embed,
    default_action_row,
    domain_emoji,
    domain_label,
    link_button,
    severity_color,
)


def test_severity_color_known_values():
    assert severity_color(Severity.INFO) == 0x5865F2
    assert severity_color(Severity.SUCCESS) == 0x57F287
    assert severity_color(Severity.WARNING) == 0xFEE75C
    assert severity_color(Severity.DANGER) == 0xED4245
    assert severity_color(Severity.URGENT) == 0xEB459E
    assert severity_color(Severity.NEUTRAL) == 0x99AAB5


def test_severity_color_accepts_string_and_falls_back_to_info():
    assert severity_color("success") == 0x57F287
    assert severity_color("nonsense") == 0x5865F2  # INFO fallback


def test_domain_emoji_and_label():
    assert domain_emoji(Domain.DOCUMENT) == "📄"
    assert domain_label(Domain.DOCUMENT) == "公文"
    assert domain_emoji("nonexistent") == "🔔"
    assert domain_label("nonexistent") == "通知"


def test_build_embed_basic_shape():
    embed = build_embed(
        Domain.DOCUMENT,
        Severity.SUCCESS,
        title="公文已核准",
        body="字號 ABC-001",
    )
    assert embed["color"] == 0x57F287
    assert embed["title"].startswith("📄 ")
    assert embed["description"] == "字號 ABC-001"
    assert embed["footer"]["text"].startswith("HCCA · 公文 · ")
    assert "timestamp" in embed


def test_build_embed_does_not_double_prefix_emoji():
    embed = build_embed(
        Domain.MEETING,
        Severity.INFO,
        title="🤝 已包含 emoji 的標題",
    )
    assert embed["title"].count("🤝") == 1


def test_build_embed_truncates_title():
    long_title = "x" * 400
    embed = build_embed(Domain.SYSTEM, Severity.INFO, title=long_title)
    # 加上 emoji + 空格 後不會超過 256
    assert len(embed["title"]) <= 256
    assert embed["title"].endswith("…")


def test_build_embed_truncates_description():
    long_body = "y" * 5000
    embed = build_embed(Domain.SYSTEM, Severity.INFO, title="t", body=long_body)
    assert len(embed["description"]) <= 4096
    assert embed["description"].endswith("…")


def test_build_embed_caps_field_count():
    fields = [{"name": f"f{i}", "value": "v"} for i in range(30)]
    embed = build_embed(Domain.SYSTEM, Severity.INFO, title="t", fields=fields)
    assert len(embed["fields"]) == 25


def test_build_embed_enforces_total_char_limit():
    huge_fields = [{"name": "n" * 250, "value": "v" * 1000} for _ in range(25)]
    embed = build_embed(
        Domain.SYSTEM,
        Severity.INFO,
        title="t",
        body="z" * 2000,
        fields=huge_fields,
    )
    total = len(embed.get("title", "")) + len(embed.get("description", ""))
    total += len(embed.get("footer", {}).get("text", ""))
    for field in embed.get("fields", []):
        total += len(field["name"]) + len(field["value"])
    assert total <= 6000


def test_build_embed_timestamp_is_iso8601():
    ts = datetime(2026, 6, 1, 8, 0, tzinfo=UTC)
    embed = build_embed(Domain.SYSTEM, Severity.INFO, title="t", timestamp=ts)
    assert embed["timestamp"].startswith("2026-06-01T08:00:00")


def test_link_button_and_action_row():
    btn = link_button("查看", "https://example.com", emoji="📄")
    assert btn["type"] == 2
    assert btn["style"] == 5
    assert btn["url"] == "https://example.com"
    assert btn["emoji"] == {"name": "📄"}
    row = action_row(btn)
    assert row["type"] == 1
    assert row["components"] == [btn]


def test_default_action_row_returns_none_when_no_buttons():
    assert default_action_row(open_url=None) is None


def test_default_action_row_absolutifies_internal_path():
    row = default_action_row(open_url="/documents/abc", domain=Domain.DOCUMENT)
    assert row is not None
    btn = row["components"][0]
    assert btn["url"].endswith("/documents/abc")
    assert btn["emoji"] == {"name": "📄"}


def test_default_action_row_caps_at_5_buttons():
    extras = [link_button(f"b{i}", f"https://example.com/{i}") for i in range(10)]
    row = default_action_row(open_url="/x", extra_buttons=extras)
    assert row is not None
    assert len(row["components"]) == 5


def test_link_button_truncates_label():
    btn = link_button("x" * 200, "https://example.com")
    assert len(btn["label"]) <= 80
