"""Email 範本渲染與富文本清洗單元測試（Phase 1）"""

from __future__ import annotations

import uuid

from api.email.renderer import (
    make_unsubscribe_token,
    parse_unsubscribe_token,
    render_email,
    sanitize_html,
)


def test_render_notification_includes_content_and_no_leftover_jinja() -> None:
    html = render_email(
        "notification",
        {
            "subject": "公文待審核",
            "heading": "您有一份公文待審核",
            "body_text": "公文已送達。\n請至系統審核。",
            "card_rows": [
                {"label": "字號", "value": "嶺代議字第1150000001號"},
                {"label": "速別", "value": "速件"},
            ],
            "cta_url": "http://localhost:3000/documents/abc",
            "cta_label": "前往審核",
            "unsubscribe_url": "http://localhost:3000/unsubscribe?token=t",
        },
    )
    assert "您有一份公文待審核" in html
    assert "嶺代議字第1150000001號" in html
    assert "前往審核" in html
    assert "不再接收此類通知" in html
    assert "公文已送達。<br>請至系統審核。" in html
    # 不得殘留未渲染的 Jinja 標記
    assert "{{" not in html
    assert "{%" not in html


def test_render_notification_omits_optional_blocks_when_absent() -> None:
    html = render_email("notification", {"heading": "純文字通知", "body_text": "內容"})
    assert "純文字通知" in html
    # 無 cta_url 時不應出現按鈕、無 unsubscribe_url 時不應出現退訂連結
    assert "border-radius:999px" not in html
    assert "不再接收此類通知" not in html
    assert "{%" not in html


def test_render_generic_injects_body_html_verbatim() -> None:
    html = render_email(
        "generic",
        {"subject": "S", "heading": "公告標題", "body_html": "<p>第一段</p><ul><li>項目</li></ul>"},
    )
    assert "公告標題" in html
    assert "<p>第一段</p>" in html
    assert "<li>項目</li>" in html


def test_render_escapes_plain_text_fields() -> None:
    # heading 為純文字欄位，autoescape 應轉義 HTML
    html = render_email("generic", {"heading": "<script>x</script>"})
    assert "<script>x</script>" not in html
    assert "&lt;script&gt;" in html


def test_sanitize_html_strips_dangerous_tags_and_protocols() -> None:
    dirty = '<p>safe</p><script>alert(1)</script><a href="javascript:bad()">x</a>'
    clean = sanitize_html(dirty)
    assert "<p>safe</p>" in clean
    assert "script" not in clean
    assert "javascript:" not in clean


def test_sanitize_html_keeps_allowed_formatting() -> None:
    clean = sanitize_html('<strong>粗</strong><a href="https://x.com">連結</a><ul><li>a</li></ul>')
    assert "<strong>粗</strong>" in clean
    assert 'href="https://x.com"' in clean
    assert "<li>a</li>" in clean


def test_unsubscribe_token_roundtrip() -> None:
    uid = uuid.uuid4()
    token = make_unsubscribe_token(uid, "document_pending")
    parsed_uid, parsed_type = parse_unsubscribe_token(token)
    assert parsed_uid == uid
    assert parsed_type == "document_pending"
