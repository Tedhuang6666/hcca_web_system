"""SSRF 防護 — 驗證「伺服器主動對外送出的請求」其目標不指向內網 / metadata。

用於 webhook 投遞等 server-side fetch：使用者能控制目標 URL 時，必須擋掉
loopback / 私有網段 / link-local（含雲端 metadata 169.254.169.254）/ 保留位址，
否則會被當成跳板讀取內部服務或竊取雲端臨時憑證。

使用：
    from api.core.ssrf import assert_safe_url, UnsafeURLError
    await assert_safe_url(url)            # 建立時即時回饋
    await assert_safe_url(sub.url)        # 投遞當下重驗（防 DNS rebinding）

note：真正杜絕 DNS rebinding 需把「驗證時解析到的 IP」釘進連線；此處採務實做法
——投遞當下重新解析並驗證，搭配 httpx follow_redirects=False，已能擋下絕大多數攻擊。
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

_ALLOWED_SCHEMES = frozenset({"http", "https"})


class UnsafeURLError(ValueError):
    """目標 URL 不被允許（協定錯誤、無法解析、或指向內網 / 保留位址）。"""


def _ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    # IPv4-mapped IPv6（::ffff:169.254.169.254）→ 還原成底層 v4 再判斷，避免繞過
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private  # 10/8、172.16/12、192.168/16、fc00::/7
        or ip.is_loopback  # 127/8、::1
        or ip.is_link_local  # 169.254/16（含雲端 metadata）、fe80::/10
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified  # 0.0.0.0、::
    )


def is_blocked_ip(ip_str: str) -> bool:
    """判斷一個 IP 字串是否落在禁止網段（無法解析視為禁止）。"""
    try:
        return _ip_is_blocked(ipaddress.ip_address(ip_str))
    except ValueError:
        return True


def _parse_host(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme.lower() not in _ALLOWED_SCHEMES:
        raise UnsafeURLError(f"不允許的協定：{parts.scheme or '(空)'}（僅允許 http/https）")
    host = parts.hostname  # 已自動去除 IPv6 的中括號
    if not host:
        raise UnsafeURLError("URL 缺少主機名稱")
    return host


async def _resolve_ips(host: str) -> list[str]:
    loop = asyncio.get_event_loop()
    try:
        infos = await loop.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeURLError(f"無法解析主機名稱：{host}") from exc
    return [info[4][0] for info in infos]


async def assert_safe_url(url: str) -> None:
    """驗證 URL 可安全地由伺服器對外請求；不安全時拋出 UnsafeURLError。

    - 協定必須是 http/https
    - 主機若為 IP 字面值，直接檢查網段
    - 主機若為網域，解析所有 A/AAAA 記錄，**任一** 落在禁止網段即拒絕
    """
    host = _parse_host(url)

    # 主機本身就是 IP 字面值：不必 DNS
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if _ip_is_blocked(literal):
            raise UnsafeURLError(f"目標位址不被允許（內網 / 保留位址）：{host}")
        return

    ips = await _resolve_ips(host)
    if not ips:
        raise UnsafeURLError(f"無法解析主機名稱：{host}")
    for ip_str in ips:
        if is_blocked_ip(ip_str):
            raise UnsafeURLError(
                f"目標位址解析到內網 / 保留位址（{host} → {ip_str}），已拒絕"
            )


__all__ = ["UnsafeURLError", "assert_safe_url", "is_blocked_ip"]
