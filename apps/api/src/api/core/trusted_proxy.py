"""信任代理 middleware — 從 CF-Connecting-IP 取真實 client IP。

啟用 `TRUST_CLOUDFLARE_PROXY=True` 後，本 middleware 會在每個 HTTP / WebSocket
請求進來時檢查：
  1. socket peer IP 是否屬於 Cloudflare 官方 CIDR（或 CF_TRUSTED_PROXIES 覆寫清單）
  2. 若是，從 `CF-Connecting-IP` header 取真實 client IP，替換 scope["client"]

這樣下游 rate_limit、anomaly_detection、audit log 都能取到使用者真實 IP，
而不是 Cloudflare edge 的 IP（否則全站會被視為同一 IP，rate limit 失效）。

僅在 socket peer 是 CF IP 時才信任 header — 防止用戶端偽造 CF-Connecting-IP。
"""

from __future__ import annotations

import ipaddress
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.types import Receive, Scope, Send

logger = logging.getLogger(__name__)


# Cloudflare 官方公開 IP 段（IPv4 + IPv6）
# 來源：https://www.cloudflare.com/ips/
# 若需更新請改 .env CF_TRUSTED_PROXIES 覆寫；長期維護應寫定期更新 cron。
_CLOUDFLARE_CIDRS: tuple[str, ...] = (
    # IPv4
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
    # IPv6
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
)


def _parse_networks(cidrs: tuple[str, ...] | list[str]) -> list[ipaddress._BaseNetwork]:
    nets: list[ipaddress._BaseNetwork] = []
    for cidr in cidrs:
        try:
            nets.append(ipaddress.ip_network(cidr, strict=False))
        except ValueError:
            logger.warning("Invalid CIDR in trusted proxy list: %s", cidr)
    return nets


class TrustedProxyMiddleware:
    """
    Pure ASGI middleware：若 socket peer ∈ 信任 CIDR，從 CF-Connecting-IP 換真實 IP。

    對 HTTP 與 WebSocket scope 都生效。lifespan scope 直接通過。
    """

    def __init__(
        self,
        app: Callable[[Scope, Receive, Send], Awaitable[None]],
        *,
        enabled: bool,
        extra_cidrs: list[str] | None = None,
    ) -> None:
        self.app = app
        self.enabled = enabled
        cidrs = list(_CLOUDFLARE_CIDRS) + list(extra_cidrs or [])
        self._networks = _parse_networks(tuple(cidrs)) if enabled else []

    def _peer_is_trusted(self, peer_ip: str) -> bool:
        if not self._networks:
            return False
        try:
            addr = ipaddress.ip_address(peer_ip)
        except ValueError:
            return False
        return any(addr in net for net in self._networks)

    @staticmethod
    def _get_header(scope: Scope, name_lower: bytes) -> str | None:
        for k, v in scope.get("headers") or []:
            if k.lower() == name_lower:
                try:
                    return v.decode("latin-1")
                except UnicodeDecodeError:
                    return None
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self.enabled or scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        client: tuple[str, int] | None = scope.get("client")
        if not client:
            await self.app(scope, receive, send)
            return

        peer_ip = client[0]
        if not self._peer_is_trusted(peer_ip):
            await self.app(scope, receive, send)
            return

        real_ip = self._get_header(scope, b"cf-connecting-ip")
        if not real_ip:
            await self.app(scope, receive, send)
            return

        real_ip = real_ip.strip()
        try:
            ipaddress.ip_address(real_ip)
        except ValueError:
            logger.warning("Invalid CF-Connecting-IP value: %r (peer=%s)", real_ip, peer_ip)
            await self.app(scope, receive, send)
            return

        new_scope: dict[str, Any] = dict(scope)
        new_scope["client"] = (real_ip, client[1])
        await self.app(new_scope, receive, send)
