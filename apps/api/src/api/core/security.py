"""JWT 安全機制 - Access / Refresh Token、jti、Redis 黑名單與 user-level revoke。"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import redis.asyncio as aioredis
from jwt.exceptions import InvalidTokenError
from redis.asyncio.connection import BlockingConnectionPool
from redis.exceptions import RedisError

from api.core.config import settings
from api.core.prometheus_metrics import set_redis_client_healthy

logger = logging.getLogger(__name__)

# --- Redis 連線 ---
# 注意：aioredis 的 ConnectionPool 會在首次 await 時把連線綁到當前 event loop，
# pytest-asyncio 每個 test 開新 loop 會撞「Future attached to a different loop」。
# 改用有界等待 pool：Lighthouse／RUM 高峰會讓多個同源 API 同時讀寫 state Redis；
# 非阻塞 pool 會在達到上限時立刻拋出「Too many connections」，連帶讓 rate-limit、
# 錯誤稽核與登入撤銷路徑降級。排隊等待可讓短暫尖峰平滑消化，外層既有 timeout
# 仍會在 Redis 真正失效時快速降級，不把請求無限卡住。
redis_client: aioredis.Redis = aioredis.Redis(
    connection_pool=BlockingConnectionPool.from_url(
        str(settings.REDIS_URL),
        encoding="utf-8",
        decode_responses=True,
        max_connections=settings.REDIS_STATE_MAX_CONNECTIONS,
        timeout=settings.REDIS_SOCKET_TIMEOUT,
        socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
        socket_connect_timeout=settings.REDIS_SOCKET_TIMEOUT,
        health_check_interval=settings.REDIS_HEALTH_CHECK_INTERVAL,
    )
)

# 以 jti 為 key（支援 user-level revoke）
BLACKLIST_JTI_PREFIX = "blacklist_jti:"
# 每 user 持有的所有 jti（refresh token 期限內）
USER_TOKENS_PREFIX = "user_tokens:"
SESSION_REVOKED_PREFIX = "session_revoked:"
_TOKEN_TRACKING_TIMEOUT_SECONDS = 0.8


class RedisUnavailableError(RuntimeError):
    """Redis 暫時不可用，無法可靠判斷 Token 是否已撤銷。"""


def _now_ts() -> int:
    return int(datetime.now(UTC).timestamp())


def _new_jti() -> str:
    return uuid.uuid4().hex


def _active_signing_key() -> str:
    return settings.JWT_SIGNING_KEY or settings.SECRET_KEY


def _signing_keys() -> dict[str, str]:
    keys = {settings.JWT_ACTIVE_KID: _active_signing_key()}
    for item in settings.JWT_PREVIOUS_SIGNING_KEYS:
        kid, separator, key = item.partition(":")
        if kid and separator and key:
            keys[kid] = key
    return keys


def token_jti_hash(jti: str) -> str:
    """雜湊 refresh jti，避免資料庫保存可直接關聯的 session identifier。"""
    key = settings.JWT_SESSION_HASH_KEY or _active_signing_key()
    return hmac.new(key.encode("utf-8"), jti.encode("utf-8"), hashlib.sha256).hexdigest()


def _create_token(data: dict, expire_delta: timedelta) -> str:
    """建立 JWT Token 的底層函式"""
    payload = data.copy()
    expire = datetime.now(UTC) + expire_delta
    payload.update(
        {
            "exp": expire,
            "iat": datetime.now(UTC),
            "iss": settings.JWT_ISSUER,
            "aud": settings.JWT_AUDIENCE,
            "ver": 2,
        }
    )
    return jwt.encode(
        payload,
        _active_signing_key(),
        algorithm=settings.ALGORITHM,
        headers={"kid": settings.JWT_ACTIVE_KID},
    )


def create_signed_token(data: dict, expire_delta: timedelta) -> str:
    """建立帶有目前 JWT metadata 與簽章設定的自訂期限 token。"""
    return _create_token(data, expire_delta)


def create_access_token(
    subject: str,
    extra_claims: dict | None = None,
    *,
    session_id: str | None = None,
    auth_time: int | None = None,
    amr: list[str] | None = None,
) -> str:
    """建立短效期 Access Token (預設 30 分鐘)，內含 jti 以支援 user-level revoke。

    若 `extra_claims` 包含 `is_admin: True`，load_shed middleware 會優先放行此請求。
    """
    data: dict = {
        "sub": subject,
        "type": "access",
        "jti": _new_jti(),
        "auth_time": auth_time if auth_time is not None else _now_ts(),
        "amr": amr or ["oauth"],
        **(extra_claims or {}),
    }
    if session_id:
        data["sid"] = session_id
    return _create_token(data, timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(subject: str, *, session_id: str | None = None) -> str:
    """建立長效期 Refresh Token (預設 7 天)"""
    data: dict = {"sub": subject, "type": "refresh", "jti": _new_jti()}
    if session_id:
        data["sid"] = session_id
    return _create_token(data, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))


def create_mfa_challenge_token(subject: str) -> str:
    """建立短效 MFA 登入挑戰 Token。"""
    data = {"sub": subject, "type": "mfa_challenge", "jti": _new_jti()}
    return _create_token(data, timedelta(minutes=settings.MFA_CHALLENGE_EXPIRE_MINUTES))


def decode_token(token: str) -> dict:
    """解碼並驗證 JWT Token，失敗時拋出 InvalidTokenError"""
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError:
        raise

    kid = header.get("kid")
    if isinstance(kid, str):
        key = _signing_keys().get(kid)
        if key is None:
            raise InvalidTokenError("未知的 JWT kid")
        return jwt.decode(
            token,
            key,
            algorithms=[settings.ALGORITHM],
            audience=settings.JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
            options={"require": ["exp", "iat", "sub", "jti", "iss", "aud"]},
        )

    if not settings.AUTH_LEGACY_TOKEN_COMPAT_ENABLED:
        raise InvalidTokenError("不再接受沒有 kid 的舊版 JWT")
    # 遷移期只相容「缺少 kid」的舊封裝，不能因此放寬 token 的到期、發行者或受眾驗證。
    legacy_keys = [_active_signing_key(), *_signing_keys().values(), settings.SECRET_KEY]
    seen: set[str] = set()
    last_error: InvalidTokenError | None = None
    for key in legacy_keys:
        if key in seen:
            continue
        seen.add(key)
        try:
            return jwt.decode(
                token,
                key,
                algorithms=[settings.ALGORITHM],
                audience=settings.JWT_AUDIENCE,
                issuer=settings.JWT_ISSUER,
                options={"require": ["exp", "iat", "sub", "jti", "iss", "aud"]},
            )
        except InvalidTokenError as exc:
            last_error = exc
    raise last_error or InvalidTokenError("無效的舊版 JWT")


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


async def is_blacklisted(
    token: str, *, fail_closed: bool = False, raise_on_unavailable: bool = False
) -> bool:
    """檢查 Token jti 是否已被撤銷。

    一般 access token 可採 fail-open，避免 Redis 暫時故障造成全站不可用；會換發
    長效憑證的 refresh 流程必須傳入 ``fail_closed=True``，避免撤銷狀態不可驗證時
    繼續延長 session。
    """
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return False
    jti = payload.get("jti")
    if not jti:
        return False
    try:
        result = bool(await redis_client.exists(f"{BLACKLIST_JTI_PREFIX}{jti}"))
        set_redis_client_healthy("state", True)
        return result
    except (RedisError, TimeoutError) as exc:
        set_redis_client_healthy("state", False)
        logger.error(
            "黑名單檢查 Redis 不可用，模式=%s",
            "fail-closed 拒絕" if fail_closed else "fail-open 放行",
            extra={"alert": "blacklist_fail_open"},
        )
        if fail_closed and raise_on_unavailable:
            raise RedisUnavailableError("Redis unavailable while checking token blacklist") from exc
        return fail_closed


# ── User-level token 追蹤與撤銷 ──────────────────────────────────────────────


async def register_active_token(user_id: str, jti: str | None, ttl_seconds: int) -> None:
    """記錄 user 持有的 jti，讓 admin 能用 user_id 反查並撤銷。

    在認證成功時呼叫（idempotent SADD）。
    """
    if not jti:
        return
    key = f"{USER_TOKENS_PREFIX}{user_id}"
    try:
        await asyncio.wait_for(
            redis_client.sadd(key, jti),
            timeout=_TOKEN_TRACKING_TIMEOUT_SECONDS,
        )
        # 用 refresh token 期限作為集合的存活上限
        await asyncio.wait_for(
            redis_client.expire(key, settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400),
            timeout=_TOKEN_TRACKING_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("jti 追蹤寫入失敗 uid=%s error=%s", user_id, type(exc).__name__)


async def revoke_user(user_id: str, *, ttl_seconds: int | None = None) -> int:
    """將某 user 持有的所有 jti 一次加入黑名單，達到「強制登出」效果。

    回傳被撤銷的 jti 數量。`ttl_seconds` 未指定時使用 refresh token 期限。
    """
    key = f"{USER_TOKENS_PREFIX}{user_id}"
    ttl = ttl_seconds if ttl_seconds is not None else settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
    try:
        jtis = await redis_client.smembers(key)
    except Exception as exc:
        # 強制登出不能把 Redis 故障誤報成「沒有可撤銷的 token」。否則管理員會
        # 看見成功回應，實際上舊 access token 仍可在效期內繼續使用。
        logger.error("黑名單撤銷查詢失敗", exc_info=True)
        raise RedisUnavailableError("Redis unavailable while revoking user tokens") from exc

    if not jtis:
        return 0

    try:
        pipe = redis_client.pipeline()
        for j in jtis:
            pipe.setex(f"{BLACKLIST_JTI_PREFIX}{j}", ttl, "1")
        pipe.delete(key)
        await pipe.execute()
    except Exception as exc:
        logger.error("黑名單撤銷寫入失敗", exc_info=True)
        raise RedisUnavailableError("Redis unavailable while revoking user tokens") from exc
    logger.info("已撤銷 %d 個 jti uid=%s", len(jtis), user_id)
    return len(jtis)


async def revoke_session(session_id: str, ttl_seconds: int) -> None:
    """標記 session 為撤銷；access token 在 Redis 可用時立即失效。"""
    if ttl_seconds <= 0:
        return
    await redis_client.setex(f"{SESSION_REVOKED_PREFIX}{session_id}", ttl_seconds, "1")


async def is_session_revoked(session_id: str | None, *, fail_closed: bool = False) -> bool:
    if not session_id:
        return False
    try:
        return bool(await redis_client.exists(f"{SESSION_REVOKED_PREFIX}{session_id}"))
    except (RedisError, TimeoutError) as exc:
        logger.error("session 撤銷狀態 Redis 不可用", exc_info=True)
        if fail_closed:
            raise RedisUnavailableError(
                "Redis unavailable while checking session revocation"
            ) from exc
        return False
