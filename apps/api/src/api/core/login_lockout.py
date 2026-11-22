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
_HEALTH_KEY_PREFIX = "login_lockout_health:"
_REDIS_TIMEOUT_SECONDS = 0.8

DEFAULT_MAX_FAILURES = 5
DEFAULT_WINDOW_SECONDS = 600  # 10 分鐘內累計
DEFAULT_LOCKOUT_SECONDS = 900  # 鎖定 15 分鐘


class LoginLockoutUnavailable(RuntimeError):
    """鎖定狀態無法確認；MFA 呼叫端必須停止驗證。"""


def _failures_key(identifier: str) -> str:
    return f"{_FAILURE_KEY_PREFIX}{identifier}"


def _lockout_key(identifier: str) -> str:
    return f"{_LOCKOUT_KEY_PREFIX}{identifier}"


async def is_locked(
    identifier: str,
    *,
    fail_closed: bool = False,
    max_failures: int = DEFAULT_MAX_FAILURES,
) -> int | None:
    """若 identifier（user_id / IP / email）目前被鎖，回傳剩餘秒數；否則回 None。"""
    if not identifier:
        return None
    try:
        ttl = await asyncio.wait_for(
            redis_client.ttl(_lockout_key(identifier)),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
    except (RedisError, TimeoutError) as exc:
        if fail_closed:
            raise LoginLockoutUnavailable("登入鎖定狀態無法讀取") from exc
        return None
    if isinstance(ttl, int) and ttl > 0:
        return ttl
    if not isinstance(ttl, int):
        if fail_closed:
            raise LoginLockoutUnavailable("登入鎖定狀態回應格式無效")
        return None
    if ttl == -1 and fail_closed:
        return DEFAULT_LOCKOUT_SECONDS
    if not fail_closed:
        return None

    try:
        failures = await asyncio.wait_for(
            redis_client.get(_failures_key(identifier)),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
        count = int(failures or 0)
        if count < max_failures:
            write_check = await asyncio.wait_for(
                redis_client.set(
                    f"{_HEALTH_KEY_PREFIX}{identifier}",
                    "1",
                    ex=1,
                ),
                timeout=_REDIS_TIMEOUT_SECONDS,
            )
            if write_check is None:
                raise LoginLockoutUnavailable("登入鎖定儲存區無法寫入")
            return None
        failure_ttl = await asyncio.wait_for(
            redis_client.ttl(_failures_key(identifier)),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
    except (RedisError, TimeoutError, TypeError, ValueError) as exc:
        raise LoginLockoutUnavailable("登入鎖定狀態無法讀取") from exc

    if failure_ttl == -2:
        return None
    if failure_ttl > 0:
        return failure_ttl
    return DEFAULT_LOCKOUT_SECONDS


async def record_failure(
    identifier: str,
    *,
    max_failures: int = DEFAULT_MAX_FAILURES,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
    lockout_seconds: int = DEFAULT_LOCKOUT_SECONDS,
    fail_closed: bool = False,
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
    except (RedisError, TimeoutError) as exc:
        if fail_closed:
            raise LoginLockoutUnavailable("登入失敗次數無法記錄") from exc
        return None

    try:
        count = int(result[0])
    except (TypeError, ValueError, IndexError) as exc:
        if fail_closed:
            raise LoginLockoutUnavailable("登入失敗次數回應格式無效") from exc
        return None

    if count >= max_failures:
        try:
            lock_result = await asyncio.wait_for(
                redis_client.set(
                    _lockout_key(identifier), str(int(time.time())), ex=lockout_seconds
                ),
                timeout=_REDIS_TIMEOUT_SECONDS,
            )
            if fail_closed and lock_result is None:
                raise LoginLockoutUnavailable("登入鎖定未寫入")
        except (RedisError, TimeoutError) as exc:
            if fail_closed:
                raise LoginLockoutUnavailable("登入鎖定無法建立") from exc
        else:
            # 鎖定後清空計數，避免下次鎖完還繼續累積。
            # 若鎖定寫入失敗，保留已達閾值的計數，strict 檢查仍會拒絕後續驗證。
            try:
                await asyncio.wait_for(
                    redis_client.delete(key),
                    timeout=_REDIS_TIMEOUT_SECONDS,
                )
            except (RedisError, TimeoutError) as exc:
                if fail_closed:
                    raise LoginLockoutUnavailable("登入鎖定計數無法重設") from exc
        # 鎖定後清空計數，避免下次鎖完還繼續累積
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
