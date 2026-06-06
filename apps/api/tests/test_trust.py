"""信任來源判定單元測試（自己人 IP 白名單 + 掃描繞過 token）— 純函式，不需 DB / Redis。"""

from __future__ import annotations

import pytest

import api.core.trust as trust
from api.core.config import settings


@pytest.fixture(autouse=True)
def _reset_trust(monkeypatch: pytest.MonkeyPatch):
    """每個測試各自設定白名單 / token，並清掉 network lru_cache。"""
    trust._trusted_networks.cache_clear()
    yield
    trust._trusted_networks.cache_clear()


def _set_trusted(monkeypatch: pytest.MonkeyPatch, ips: list[str]) -> None:
    monkeypatch.setattr(settings, "RATE_LIMIT_TRUSTED_IPS", ips)
    trust._trusted_networks.cache_clear()


def _scope(headers=None, client=("8.8.8.8", 1234)) -> dict:
    return {"type": "http", "headers": headers or [], "client": client}


# ---- IP 白名單 ----
def test_trusted_ip_exact_match(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_trusted(monkeypatch, ["203.0.113.7", "127.0.0.1"])
    assert trust.is_trusted_ip("203.0.113.7")
    assert trust.is_trusted_ip("127.0.0.1")
    assert not trust.is_trusted_ip("8.8.8.8")


def test_trusted_ip_cidr(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_trusted(monkeypatch, ["10.0.0.0/8"])
    assert trust.is_trusted_ip("10.5.6.7")
    assert not trust.is_trusted_ip("11.0.0.1")


def test_trusted_ip_empty_or_garbage(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_trusted(monkeypatch, [])
    assert not trust.is_trusted_ip("127.0.0.1")
    _set_trusted(monkeypatch, ["203.0.113.7"])
    assert not trust.is_trusted_ip("not-an-ip")


# ---- 掃描繞過 token ----
_TOKEN = "supersecretscantoken_abcdef123456"  # >= 16 chars


def test_scan_token_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SECURITY_SCAN_BYPASS_TOKEN", _TOKEN)
    assert trust.has_scan_bypass_token(_scope([(b"x-security-scan", _TOKEN.encode())]))


def test_scan_token_wrong(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SECURITY_SCAN_BYPASS_TOKEN", _TOKEN)
    assert not trust.has_scan_bypass_token(_scope([(b"x-security-scan", b"wrong")]))
    assert not trust.has_scan_bypass_token(_scope([]))


def test_scan_token_disabled_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    # 未設定 token：即使帶空 header 也不得繞過（防空 token 漏洞）
    monkeypatch.setattr(settings, "SECURITY_SCAN_BYPASS_TOKEN", "")
    assert not trust.has_scan_bypass_token(_scope([(b"x-security-scan", b"")]))


def test_scan_token_disabled_when_too_short(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SECURITY_SCAN_BYPASS_TOKEN", "short")
    assert not trust.has_scan_bypass_token(_scope([(b"x-security-scan", b"short")]))


# ---- 綜合判定 ----
def test_request_is_trusted_combinations(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_trusted(monkeypatch, ["203.0.113.7"])
    monkeypatch.setattr(settings, "SECURITY_SCAN_BYPASS_TOKEN", _TOKEN)

    # 非白名單 IP + 有效 token → 信任
    assert trust.request_is_trusted(
        _scope([(b"x-security-scan", _TOKEN.encode())], client=("8.8.8.8", 1))
    )
    # 白名單 IP + 無 token → 信任
    assert trust.request_is_trusted(_scope([], client=("203.0.113.7", 1)))
    # 非白名單 IP + 無 token → 不信任
    assert not trust.request_is_trusted(_scope([], client=("8.8.8.8", 1)))
