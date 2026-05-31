"""JWT 安全機制 - Access / Refresh Token、jti、Redis 黑名單與 user-level revoke。"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import redis.asyncio as aioredis
from jwt.exceptions import InvalidTokenError

from api.core.config import settings

logger = logging.getLogger(__name__)

# --- Redis 連線 ---
# 注意：aioredis 的 ConnectionPool 會在首次 await 時把連線綁到當前 event loop，
# pytest-asyncio 每個 test 開新 loop 會撞「Future attached to a different loop」。
# 改回 `from_url(...)` 配合 max_connections kwarg；底層仍是 pool，但 lazy 建立
# 連線比較寬容跨 loop。生產環境 Gunicorn 每個 worker 是獨立 loop，不受影響。
redis_client: aioredis.Redis = aioredis.from_url(
    str(settings.REDIS_URL),
    encoding="utf-8",
    decode_responses=True,
    max_connections=settings.REDIS_MAX_CONNECTIONS,
    socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
    socket_connect_timeout=settings.REDIS_SOCKET_TIMEOUT,
    health_check_interval=settings.REDIS_HEALTH_CHECK_INTERVAL,
)

# 以 jti 為 key（支援 user-level revoke）
BLACKLIST_JTI_PREFIX = "blacklist_jti:"
# 每 user 持有的所有 jti（refresh token 期限內）
USER_TOKENS_PREFIX = "user_tokens:"


def _now_ts() -> int:
    return int(datetime.now(UTC).timestamp())


def _new_jti() -> str:
    return uuid.uuid4().hex


def _create_token(data: dict, expire_delta: timedelta) -> str:
    """建立 JWT Token 的底層函式"""
    payload = data.copy()
    expire = datetime.now(UTC) + expire_delta
    payload.update({"exp": expire, "iat": datetime.now(UTC)})
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(subject: str, extra_claims: dict | None = None) -> str:
    """建立短效期 Access Token (預設 30 分鐘)，內含 jti 以支援 user-level revoke。

    若 `extra_claims` 包含 `is_admin: True`，load_shed middleware 會優先放行此請求。
    """
    data: dict = {"sub": subject, "type": "access", "jti": _new_jti(), **(extra_claims or {})}
    return _create_token(data, timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(subject: str) -> str:
    """建立長效期 Refresh Token (預設 7 天)"""
    data = {"sub": subject, "type": "refresh", "jti": _new_jti()}
    return _create_token(data, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))


def create_mfa_challenge_token(subject: str) -> str:
    """建立短效 MFA 登入挑戰 Token。"""
    data = {"sub": subject, "type": "mfa_challenge", "jti": _new_jti()}
    return _create_token(data, timedelta(minutes=settings.MFA_CHALLENGE_EXPIRE_MINUTES))


def decode_token(token: str) -> dict:
    """解碼並驗證 JWT Token，失敗時拋出 InvalidTokenError"""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


# ── 黑名單 ────────────────────────────────────────────────────────────────────


async def add_to_blacklist(token: str) -> None:
    """將 Token jti 加入 Redis 黑名單（有效期至 Token 過期時間）。"""
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return  # 已過期或無效的 Token 不需加入黑名單

    exp: int = payload.get("exp", 0)
    ttl = max(0, exp - _now_ts())
    if ttl <= 0:
        return

    jti = payload.get("jti")
    if jti:
        await redis_client.setex(f"{BLACKLIST_JTI_PREFIX}{jti}", ttl, "1")


async def is_blacklisted(token: str) -> bool:
    """檢查 Token jti 是否已被撤銷。"""
    try:
        payload = decode_token(token)
        jti = payload.get("jti")
        if jti and await redis_client.exists(f"{BLACKLIST_JTI_PREFIX}{jti}"):
            return True
    except InvalidTokenError:
        pass
    return False


# ── User-level token 追蹤與撤銷 ──────────────────────────────────────────────


async def register_active_token(user_id: str, jti: str | None, ttl_seconds: int) -> None:
    """記錄 user 持有的 jti，讓 admin 能用 user_id 反查並撤銷。

    在認證成功時呼叫（idempotent SADD）。
    """
    if not jti:
        return
    key = f"{USER_TOKENS_PREFIX}{user_id}"
    try:
        await redis_client.sadd(key, jti)
        # 用 refresh token 期限作為集合的存活上限
        await redis_client.expire(key, settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400)
    except Exception:
        logger.warning("register_active_token failed user=%s", user_id, exc_info=True)


async def revoke_user(user_id: str, *, ttl_seconds: int | None = None) -> int:
    """將某 user 持有的所有 jti 一次加入黑名單，達到「強制登出」效果。

    回傳被撤銷的 jti 數量。`ttl_seconds` 未指定時使用 refresh token 期限。
    """
    key = f"{USER_TOKENS_PREFIX}{user_id}"
    ttl = ttl_seconds if ttl_seconds is not None else settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    try:
        jtis = await redis_client.smembers(key)
    except Exception:
        logger.warning("revoke_user smembers failed user=%s", user_id, exc_info=True)
        return 0

    if not jtis:
        return 0

    pipe = redis_client.pipeline()
    for j in jtis:
        pipe.setex(f"{BLACKLIST_JTI_PREFIX}{j}", ttl, "1")
    pipe.delete(key)
    await pipe.execute()
    logger.info("revoked %d tokens for user=%s", len(jtis), user_id)
    return len(jtis)
