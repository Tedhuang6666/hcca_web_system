"""JWT 安全機制 - Access Token / Refresh Token / Redis 黑名單"""

from datetime import UTC, datetime, timedelta

import jwt
import redis.asyncio as aioredis
from jwt.exceptions import InvalidTokenError

from api.core.config import settings

# --- Redis 連線 ---
redis_client: aioredis.Redis = aioredis.from_url(
    str(settings.REDIS_URL), encoding="utf-8", decode_responses=True
)

BLACKLIST_PREFIX = "blacklist:"


def _create_token(data: dict, expire_delta: timedelta) -> str:
    """建立 JWT Token 的底層函式"""
    payload = data.copy()
    expire = datetime.now(UTC) + expire_delta
    payload.update({"exp": expire, "iat": datetime.now(UTC)})
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(subject: str, extra_claims: dict | None = None) -> str:
    """建立短效期 Access Token (預設 30 分鐘)"""
    data = {"sub": subject, "type": "access", **(extra_claims or {})}
    return _create_token(data, timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(subject: str) -> str:
    """建立長效期 Refresh Token (預設 7 天)"""
    data = {"sub": subject, "type": "refresh"}
    return _create_token(data, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))


def create_mfa_challenge_token(subject: str) -> str:
    """建立短效 MFA 登入挑戰 Token。"""
    data = {"sub": subject, "type": "mfa_challenge"}
    return _create_token(data, timedelta(minutes=settings.MFA_CHALLENGE_EXPIRE_MINUTES))


def decode_token(token: str) -> dict:
    """解碼並驗證 JWT Token，失敗時拋出 InvalidTokenError"""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


async def add_to_blacklist(token: str) -> None:
    """將 Token 加入 Redis 黑名單（有效期至 Token 過期時間）"""
    try:
        payload = decode_token(token)
        exp: int = payload.get("exp", 0)
        ttl = max(0, exp - int(datetime.now(UTC).timestamp()))
        if ttl > 0:
            await redis_client.setex(f"{BLACKLIST_PREFIX}{token}", ttl, "1")
    except InvalidTokenError:
        pass  # 已過期或無效的 Token 不需要加入黑名單


async def is_blacklisted(token: str) -> bool:
    """檢查 Token 是否在黑名單中"""
    return bool(await redis_client.exists(f"{BLACKLIST_PREFIX}{token}"))
