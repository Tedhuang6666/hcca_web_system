"""custom_css 清洗單元測試。"""

from __future__ import annotations

import pytest

from api.services.site import sanitize_css


@pytest.mark.parametrize(
    "payload",
    [
        "</style><script>alert(document.cookie)</script>",
        "x{}</STYLE><img src=x onerror=alert(1)>",
        "@import url('//evil.test/x.css');",
        "body{background:expression(alert(1))}",
        "a{background:url(javascript:alert(1))}",
        "div{behavior:url(#default#time2)}",
        "<!-- --><script>x</script>",
    ],
)
def test_dangerous_tokens_removed(payload: str) -> None:
    cleaned = sanitize_css(payload) or ""
    lowered = cleaned.lower()
    assert "<script" not in lowered
    assert "</style" not in lowered
    assert "@import" not in lowered
    assert "expression(" not in lowered
    assert "javascript:" not in lowered
    assert "behavior:" not in lowered
    assert "<img" not in lowered


def test_legitimate_css_preserved() -> None:
    css = ".nav > .item:hover { color: #fff; background: url(https://cdn.test/a.png); }"
    cleaned = sanitize_css(css)
    # 合法 CSS（含子選擇器 > 與 https url）不應被破壞
    assert cleaned == css


def test_none_and_empty_passthrough() -> None:
    assert sanitize_css(None) is None
    assert sanitize_css("") == ""
