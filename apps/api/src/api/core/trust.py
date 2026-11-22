"""信任來源判定 — 自己人 IP 白名單 + 主動掃描繞過 token。

兩種繞過，目的都是讓「自己人」不要被自家防護鎖在門外：

  1. RATE_LIMIT_TRUSTED_IPS：常駐 IP / CIDR 白名單（家用固定 IP、辦公室、127.0.0.1）。
       - 豁免 rate limit
       - 豁免 IP 黑名單（含 WAF autoblock 後的封鎖）
       - 不會被 WAF autoblock 計數
     仍受 WAF 單次特徵攔截 —— 真的打到注入字串還是會被擋（縱深防禦）。

  2. SECURITY_SCAN_BYPASS_TOKEN：請求帶 `X-Security-Scan: <token>`。
     完全繞過 WAF / rate limit / IP 黑名單，供 Nuclei 等弱掃工具對自家站台施測。
     token 須夠長（>= _MIN_TOKEN_LEN）；未設定 / 過短時 header 一律無效，
     避免「空 token == 任何人帶空 header 即繞過」的漏洞。比對採 constant-time。

所有判定皆為純函式、零 I/O，可安全用於熱路徑 middleware。
"""

from __future__ import annotations

import hmac
import ipaddress
from functools import lru_cache

from starlette.types import Scope

from api.core.config import settings

_SCAN_HEADER = b"x-security-scan"
_MIN_TOKEN_LEN = 16


@lru_cache(maxsize=1)
def _trusted_networks() -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    """解析 RATE_LIMIT_TRUSTED_IPS 成 network 物件；設定啟動後不變，快取即可。"""
    nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for entry in settings.RATE_LIMIT_TRUSTED_IPS:
        cleaned = entry.strip()
        if not cleaned:
            continue
        try:
            nets.append(ipaddress.ip_network(cleaned, strict=False))
        except ValueError:
            continue
    return tuple(nets)


def is_trusted_ip(ip: str) -> bool:
    """IP 是否在 RATE_LIMIT_TRUSTED_IPS 白名單（支援單一 IP 與 CIDR）。"""
    nets = _trusted_networks()
    if not nets:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in nets)


def has_scan_bypass_token(scope: Scope) -> bool:
    """請求是否帶有有效的 X-Security-Scan 繞過 token（constant-time 比對）。"""
    expected = settings.SECURITY_SCAN_BYPASS_TOKEN
    if not expected or len(expected) < _MIN_TOKEN_LEN:
        return False
    for k, v in scope.get("headers") or []:
        if k.lower() == _SCAN_HEADER:
            try:
                provided = v.decode("latin-1")
            except UnicodeDecodeError:
                return False
            return hmac.compare_digest(provided, expected)
    return False


def request_is_trusted(scope: Scope) -> bool:
    """請求是否來自信任來源（白名單 IP 或帶有效掃描 token）。"""
    if has_scan_bypass_token(scope):
        return True
    client = scope.get("client")
    return bool(client) and is_trusted_ip(client[0])
