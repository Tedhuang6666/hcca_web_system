"""IP 黑名單 — 由 admin 主動封鎖、或 anomaly_detection 自動加入。

存儲：Redis hash `ip:blocklist`，field=IP，value=JSON `{reason, expires_at}`。
查詢頻次高（每個 request 都查），用本地 5s LRU 快取避免每次打 Redis。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from redis.exceptions import RedisError

from api.core.defense import is_ip_allowed, is_ip_blocked
from api.core.security import redis_client

logger = logging.getLogger(__name__)

BLOCKLIST_KEY = "ip:blocklist"
_LOCAL_CACHE_TTL = 5.0

_cache: dict[str, tuple[float, bool]] = {}
_cache_lock = asyncio.Lock()


async def is_blocked(ip: str) -> bool:
    """檢查 IP 是否在黑名單；用本地快取攤平 Redis 壓力。"""
    if await is_ip_allowed(ip):
        _cache[ip] = (time.monotonic() + _LOCAL_CACHE_TTL, False)
        return False

    now = time.monotonic()
    cached = _cache.get(ip)
    if cached and cached[0] > now:
        return cached[1]

    try:
        raw = await asyncio.wait_for(redis_client.hget(BLOCKLIST_KEY, ip), timeout=0.8)
    except (RedisError, TimeoutError):
        return False  # Redis 異常時不擋（避免誤殺）

    blocked = False
    if raw:
        try:
            data = json.loads(raw)
            expires_at = data.get("expires_at")
            if expires_at is None or expires_at > time.time():
                blocked = True
            else:
                # 過期但仍在 hash 裡 — 順手清掉
                with contextlib.suppress(RedisError, TimeoutError):
                    await asyncio.wait_for(redis_client.hdel(BLOCKLIST_KEY, ip), timeout=0.8)
        except (json.JSONDecodeError, TypeError):
            blocked = True  # corrupt 條目視為封鎖，等 admin 清理

    if not blocked:
        blocked = await is_ip_blocked(ip)

    _cache[ip] = (now + _LOCAL_CACHE_TTL, blocked)
    return blocked


async def block(ip: str, *, reason: str = "", ttl_seconds: int | None = 3600) -> None:
    """加入黑名單；ttl_seconds=None 代表永久。"""
    expires_at = (time.time() + ttl_seconds) if ttl_seconds else None
    payload = json.dumps({"reason": reason, "expires_at": expires_at})
    try:
        await redis_client.hset(BLOCKLIST_KEY, ip, payload)
        logger.warning("IP blocked ip=%s reason=%s ttl=%s", ip, reason, ttl_seconds)
    except RedisError:
        logger.error("Failed to block IP=%s", ip, exc_info=True)
        return
    # 清本地快取讓下個 request 立即看到
    _cache.pop(ip, None)


async def unblock(ip: str) -> bool:
    try:
        removed = await redis_client.hdel(BLOCKLIST_KEY, ip)
    except RedisError:
        return False
    _cache.pop(ip, None)
    return bool(removed)


async def list_blocked() -> list[dict[str, Any]]:
    """admin 後台用：列出所有目前被封鎖的 IP 與原因。"""
    try:
        raw = await redis_client.hgetall(BLOCKLIST_KEY)
    except RedisError:
        return []
    items: list[dict[str, Any]] = []
    now = time.time()
    for ip, payload in raw.items():
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            data = {"reason": "corrupt", "expires_at": None}
        expires_at = data.get("expires_at")
        if expires_at is not None and expires_at < now:
            continue
        items.append({"ip": ip, **data})
    return items


def clear_cache() -> None:
    """測試用：清本地快取。"""
    _cache.clear()
