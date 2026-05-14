"""Redis 應用層快取 - 組織、權限、公文列表"""

import json
from typing import Any

from api.core.config import settings
from api.core.security import redis_client


async def cache_get(key: str) -> Any | None:
    """從 Redis 快取取得值"""
    try:
        value = await redis_client.get(key)
        if value is None:
            return None
        return json.loads(value)
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl: int = 60) -> None:
    """設定 Redis 快取值，TTL 單位秒"""
    try:
        serialized = json.dumps(value, default=str)
        await redis_client.setex(key, ttl, serialized)
    except Exception:
        pass  # 忽略快取寫入失敗，不中斷業務邏輯


async def cache_invalidate(pattern: str) -> None:
    """清除符合 glob pattern 的所有快取鍵（如 org:tree:*）"""
    try:
        keys = []
        cursor = 0
        while True:
            cursor, batch = await redis_client.scan(cursor, match=pattern, count=100)
            keys.extend(batch)
            if cursor == 0:
                break
        if keys:
            await redis_client.delete(*keys)
    except Exception:
        pass


async def cache_invalidate_org(org_id: str) -> None:
    """清除組織相關快取"""
    await cache_invalidate(f"org:tree:{org_id}")


async def cache_invalidate_user_permissions(user_id: str) -> None:
    """清除使用者權限快取"""
    await cache_invalidate(f"perm:{user_id}*")


async def cache_invalidate_doc_list() -> None:
    """清除公文列表快取"""
    await cache_invalidate("doc:list:*")
