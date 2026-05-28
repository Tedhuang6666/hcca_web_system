"""登入失敗鎖定：Redis-backed sliding window 計數，避免暴力破解 MFA / 重複嘗試登入。"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from redis.exceptions import RedisError

from api.core.security import redis_client

logger = logging.getLogger(__name__)

_LOCKOUT_KEY_PREFIX = "login_lockout:"
_FAILURE_KEY_PREFIX = "login_failures:"
_REDIS_TIMEOUT_SECONDS = 0.8

DEFAULT_MAX_FAILURES = 5
DEFAULT_WINDOW_SECONDS = 600  # 10 分鐘內累計
DEFAULT_LOCKOUT_SECONDS = 900  # 鎖定 15 分鐘


def _failures_key(identifier: str) -> str:
    return f"{_FAILURE_KEY_PREFIX}{identifier}"


def _lockout_key(identifier: str) -> str:
    return f"{_LOCKOUT_KEY_PREFIX}{identifier}"


async def is_locked(identifier: str) -> int | None:
    """若 identifier（user_id / IP / email）目前被鎖，回傳剩餘秒數；否則回 None。"""
    if not identifier:
        return None
    try:
        ttl = await asyncio.wait_for(
            redis_client.ttl(_lockout_key(identifier)),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
    except (RedisError, TimeoutError):
        return None
    if isinstance(ttl, int) and ttl > 0:
        return ttl
    return None


async def record_failure(
    identifier: str,
    *,
    max_failures: int = DEFAULT_MAX_FAILURES,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
    lockout_seconds: int = DEFAULT_LOCKOUT_SECONDS,
) -> int | None:
    """
    紀錄一次失敗，若達閾值則建立鎖。回傳鎖定剩餘秒數（剛鎖定）或 None（尚未鎖定）。

    使用 INCR + EXPIRE 實作 sliding-ish window：每次失敗 INCR，第一次寫入時 EXPIRE。
    """
    if not identifier:
        return None
    key = _failures_key(identifier)
    try:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds)
        result = await asyncio.wait_for(pipe.execute(), timeout=_REDIS_TIMEOUT_SECONDS)
    except (RedisError, TimeoutError):
        return None

    try:
        count = int(result[0])
    except (TypeError, ValueError, IndexError):
        return None

    if count >= max_failures:
        with contextlib.suppress(RedisError, TimeoutError):
            await asyncio.wait_for(
                redis_client.set(
                    _lockout_key(identifier), str(int(time.time())), ex=lockout_seconds
                ),
                timeout=_REDIS_TIMEOUT_SECONDS,
            )
        # 鎖定後清空計數，避免下次鎖完還繼續累積
        with contextlib.suppress(RedisError, TimeoutError):
            await asyncio.wait_for(
                redis_client.delete(key),
                timeout=_REDIS_TIMEOUT_SECONDS,
            )
        logger.warning(
            "Login lockout triggered: identifier=%s failures=%s lockout=%ss",
            identifier,
            count,
            lockout_seconds,
        )
        return lockout_seconds
    return None


async def record_success(identifier: str) -> None:
    """成功登入：清除失敗計數與鎖定（如果有）。"""
    if not identifier:
        return
    with contextlib.suppress(RedisError, TimeoutError):
        await asyncio.wait_for(
            redis_client.delete(_failures_key(identifier), _lockout_key(identifier)),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )


async def admin_unlock(identifier: str) -> None:
    """管理員強制解鎖。"""
    await record_success(identifier)
