"""safe_next_path Open Redirect 防護單元測試 (CWE-601)"""

import pytest

from api.core.redirects import safe_next_path


@pytest.mark.parametrize(
    "value",
    [
        "/",
        "/dashboard",
        "/documents/123",
        "/auth/callback?next=/x",
        "/a/b/c?q=1&r=2#frag",
    ],
)
def test_allows_site_relative_paths(value: str) -> None:
    assert safe_next_path(value) == value


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "https://evil.com",
        "http://evil.com/x",
        "evil.com",
        "//evil.com",  # 協定相對
        "/\\evil.com",  # 反斜線 → 瀏覽器正規化成 //
        "/%2f%2fevil.com",  # 編碼斜線
        "/%5cevil.com",  # 編碼反斜線
        "/\r/evil.com",  # CR 注入
        "/\n//evil.com",  # LF 注入
        "/\tpath",  # tab
        "javascript:alert(1)",
    ],
)
def test_rejects_open_redirect_payloads(value: str | None) -> None:
    assert safe_next_path(value) == "/"


def test_custom_default_is_returned_on_reject() -> None:
    assert safe_next_path("//evil.com", default="/profile") == "/profile"
    assert safe_next_path(None, default="/profile") == "/profile"


def test_uppercase_encoded_prefix_is_rejected() -> None:
    assert safe_next_path("/%2F%2Fevil.com") == "/"
    assert safe_next_path("/%5CEvil") == "/"
