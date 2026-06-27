"""Redis 應用層快取 - 組織、權限、公文列表"""

import json
import logging
from typing import Any

from api.core.security import redis_client

logger = logging.getLogger(__name__)


async def cache_get(key: str) -> Any | None:
    """從 Redis 快取取得值；Redis 異常時 fallback 為 cache miss 並記錄。"""
    try:
        value = await redis_client.get(key)
        if value is None:
            return None
        return json.loads(value)
    except Exception:
        logger.warning("cache_get failed (fallback to miss) key=%s", key, exc_info=True)
        return None


async def cache_set(key: str, value: Any, ttl: int = 60) -> None:
    """設定 Redis 快取值；Redis 異常時記錄但不中斷業務邏輯。"""
    try:
        serialized = json.dumps(value, default=str)
        await redis_client.setex(key, ttl, serialized)
    except Exception:
        logger.error("cache_set failed key=%s ttl=%d", key, ttl, exc_info=True)


async def cache_invalidate(pattern: str, max_iterations: int = 500) -> None:
    """清除符合 glob pattern 的所有快取鍵；Redis 異常時記錄但不中斷。"""
    try:
        keys: list[str] = []
        cursor = 0
        for _ in range(max_iterations):
            cursor, batch = await redis_client.scan(cursor, match=pattern, count=100)
            keys.extend(batch)
            if cursor == 0:
                break
        else:
            logger.warning("cache_invalidate iteration limit reached pattern=%s keys_so_far=%d", pattern, len(keys))
        if keys:
            await redis_client.unlink(*keys)
    except Exception:
        logger.error("cache_invalidate failed pattern=%s", pattern, exc_info=True)


async def cache_invalidate_org(org_id: str) -> None:
    """清除組織相關快取"""
    await cache_invalidate(f"org:tree:{org_id}")


async def cache_invalidate_user_permissions(user_id: str) -> None:
    """清除使用者權限快取"""
    await cache_invalidate(f"perm:{user_id}*")


async def cache_invalidate_doc_list(org_id: str | None = None) -> None:
    """清除公文列表快取；指定 org_id 只清該組織的，否則清全部。"""
    pattern = f"doc:list:{org_id}:*" if org_id else "doc:list:*"
    await cache_invalidate(pattern)
