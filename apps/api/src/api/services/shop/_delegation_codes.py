"""七位數代訂授權碼；有效期沿用連結的商品截止、結單與撤銷檢查。"""

import asyncio
import hashlib
import secrets
from datetime import UTC, datetime

from redis.exceptions import RedisError

from api.core.security import redis_client

_ATTEMPT_WINDOW_SECONDS = 10 * 60
_PREFIX = "shop:delegation-code:"


class DelegationCodeError(ValueError):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def issue_code(token: str) -> tuple[str, None]:
    """NX 防止並行撞碼；不設固定期限，兌換時仍須驗證原連結是否開放。"""
    try:
        async with asyncio.timeout(1):
            for _ in range(10):
                code = f"{secrets.randbelow(10_000_000):07d}"
                if await redis_client.set(f"{_PREFIX}value:{_digest(code)}", token, nx=True):
                    return code, None
    except (RedisError, TimeoutError) as error:
        raise DelegationCodeError("授權碼服務暫時無法使用，請稍後再建立授權", 503) from error
    raise DelegationCodeError("暫時無法產生授權碼，請稍後再試", 503)


async def exchange_code(code: str, *, actor_id: str, client_ip: str) -> str:
    """獨立於可關閉的全域限流；帳號與來源皆計數，Redis 故障時不放行。"""
    try:
        async with asyncio.timeout(1):
            bucket = int(datetime.now(UTC).timestamp()) // _ATTEMPT_WINDOW_SECONDS
            keys = [
                f"{_PREFIX}attempt:account:{actor_id}:{bucket}",
                f"{_PREFIX}attempt:ip:{_digest(client_ip)}:{bucket}",
            ]
            async with redis_client.pipeline(transaction=True) as pipe:
                for key in keys:
                    pipe.incr(key)
                    pipe.expire(key, _ATTEMPT_WINDOW_SECONDS * 2)
                counts = await pipe.execute()
            if counts[0] > 5 or counts[2] > 30:
                raise DelegationCodeError(
                    "授權碼嘗試次數過多，請 10 分鐘後再試或使用學生傳來的連結", 429
                )
            token = await redis_client.get(f"{_PREFIX}value:{_digest(code)}")
    except (RedisError, TimeoutError) as error:
        raise DelegationCodeError(
            "授權碼服務暫時無法使用，請改用學生傳來的連結或稍後再試", 503
        ) from error
    if not token:
        raise DelegationCodeError("授權碼無效或已過期，請確認七位數字，或請學生重新建立授權", 404)
    return str(token)
