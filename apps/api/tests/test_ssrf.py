"""SSRF guard 單元測試 — 純邏輯 + IP 字面值，不依賴外部 DNS。"""

from __future__ import annotations

import pytest

from api.core.ssrf import UnsafeURLError, assert_safe_url, is_blocked_ip


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",  # 雲端 metadata
        "0.0.0.0",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:169.254.169.254",  # IPv4-mapped 繞過嘗試
        "not-an-ip",
    ],
)
def test_blocked_ips(ip: str) -> None:
    assert is_blocked_ip(ip) is True


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "93.184.216.34"])
def test_public_ips_allowed(ip: str) -> None:
    assert is_blocked_ip(ip) is False


async def test_assert_safe_url_blocks_metadata_ip() -> None:
    with pytest.raises(UnsafeURLError):
        await assert_safe_url("http://169.254.169.254/latest/meta-data/")


async def test_assert_safe_url_blocks_loopback() -> None:
    with pytest.raises(UnsafeURLError):
        await assert_safe_url("http://127.0.0.1:6379/")


async def test_assert_safe_url_blocks_private_literal() -> None:
    with pytest.raises(UnsafeURLError):
        await assert_safe_url("https://10.1.2.3/internal")


@pytest.mark.parametrize("url", ["ftp://example.com/x", "file:///etc/passwd", "gopher://x"])
async def test_assert_safe_url_blocks_bad_scheme(url: str) -> None:
    with pytest.raises(UnsafeURLError):
        await assert_safe_url(url)


async def test_assert_safe_url_allows_public_ip_literal() -> None:
    # 公開 IP 字面值不需 DNS；不應拋出
    await assert_safe_url("https://8.8.8.8/webhook")


async def test_assert_safe_url_missing_host() -> None:
    with pytest.raises(UnsafeURLError):
        await assert_safe_url("http:///nohost")
