"""JWT 安全機制單元測試"""

import asyncio
import socket
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import jwt
import pytest
from jwt.exceptions import InvalidTokenError

from api.core import security
from api.core.security import (
    RedisUnavailableError,
    create_access_token,
    create_refresh_token,
    decode_token,
    revoke_user,
)
from api.dependencies import auth as auth_dependency
from api.models.user import User
from api.models.user_session import UserSession
from api.services import user_session


def test_create_and_decode_access_token() -> None:
    """測試 Access Token 的建立與解碼"""
    token = create_access_token(subject="user-123")
    payload = decode_token(token)

    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"
    assert "exp" in payload
    assert "iat" in payload
    assert payload["iss"] == security.settings.JWT_ISSUER
    assert payload["aud"] == security.settings.JWT_AUDIENCE
    assert payload["ver"] == 2


def test_create_and_decode_refresh_token() -> None:
    """測試 Refresh Token 的建立與解碼"""
    token = create_refresh_token(subject="user-456")
    payload = decode_token(token)

    assert payload["sub"] == "user-456"
    assert payload["type"] == "refresh"


def test_decode_invalid_token_raises() -> None:
    """測試解碼無效 Token 時應拋出例外"""
    with pytest.raises(InvalidTokenError):
        decode_token("this.is.not.a.valid.jwt")


def test_decode_token_rejects_legacy_token_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security.settings, "AUTH_LEGACY_TOKEN_COMPAT_ENABLED", False)
    token = jwt.encode(
        {
            "sub": "user-legacy",
            "jti": "legacy-jti",
            "iat": security._now_ts(),
            "exp": security._now_ts() + 60,
            "iss": security.settings.JWT_ISSUER,
            "aud": security.settings.JWT_AUDIENCE,
        },
        security._active_signing_key(),
        algorithm=security.settings.ALGORITHM,
    )

    with pytest.raises(InvalidTokenError, match="沒有 kid"):
        decode_token(token)


def test_decode_legacy_token_requires_standard_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security.settings, "AUTH_LEGACY_TOKEN_COMPAT_ENABLED", True)
    token = jwt.encode(
        {"sub": "user-legacy", "jti": "legacy-jti"},
        security._active_signing_key(),
        algorithm=security.settings.ALGORITHM,
    )

    with pytest.raises(InvalidTokenError):
        decode_token(token)


def test_decode_legacy_token_with_standard_claims_is_supported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(security.settings, "AUTH_LEGACY_TOKEN_COMPAT_ENABLED", True)
    token = jwt.encode(
        {
            "sub": "user-legacy",
            "jti": "legacy-jti",
            "iat": security._now_ts(),
            "exp": security._now_ts() + 60,
            "iss": security.settings.JWT_ISSUER,
            "aud": security.settings.JWT_AUDIENCE,
        },
        security._active_signing_key(),
        algorithm=security.settings.ALGORITHM,
    )

    assert decode_token(token)["sub"] == "user-legacy"


def test_access_token_has_extra_claims() -> None:
    """測試 Access Token 可附帶額外 Claims"""
    token = create_access_token(subject="user-789", extra_claims={"role": "admin"})
    payload = decode_token(token)

    assert payload["role"] == "admin"
    assert payload["sub"] == "user-789"


async def test_v2_access_token_uses_live_user_and_durable_session(
    monkeypatch: pytest.MonkeyPatch,
    db_session,
) -> None:
    user = User(email="member@school.edu", display_name="成員", is_verified=True)
    db_session.add(user)
    await db_session.flush()
    tokens = await user_session.issue_session_tokens(
        db_session,
        user_id=user.id,
        extra_claims={"user": {"email": "outdated@school.edu", "display_name": "舊名稱"}},
        user_agent=None,
        ip_address=None,
        auth_method="oauth",
    )
    monkeypatch.setattr(auth_dependency, "is_blacklisted", AsyncMock(return_value=False))
    monkeypatch.setattr(auth_dependency, "is_session_revoked", AsyncMock(return_value=False))

    resolved = await auth_dependency._user_from_access_token(tokens.access_token, db_session)

    assert resolved is user
    assert resolved.email == "member@school.edu"

    tokens.session.revoked_at = datetime.now(UTC)
    await db_session.flush()
    assert await auth_dependency._user_from_access_token(tokens.access_token, db_session) is None


async def test_list_active_returns_every_unrevoked_session(db_session) -> None:
    user = User(email="sessions@example.com", display_name="Sessions", is_verified=True)
    db_session.add(user)
    await db_session.flush()
    now = datetime.now(UTC)
    for index in range(51):
        db_session.add(
            UserSession(
                user_id=user.id,
                refresh_jti_hash=f"session-{index}",
                auth_method="oauth",
                auth_time=now,
                last_seen_at=now,
                rotated_at=now,
                expires_at=now + timedelta(days=1),
                absolute_expires_at=now + timedelta(days=7),
            )
        )
    await db_session.flush()

    assert len(await user_session.list_active(db_session, user.id)) == 51


async def test_revoke_others_preserves_current_session(db_session) -> None:
    user = User(email="keep-session@example.com", display_name="保留目前工作階段", is_verified=True)
    db_session.add(user)
    await db_session.flush()
    current = await user_session.issue_session_tokens(
        db_session,
        user_id=user.id,
        extra_claims=None,
        user_agent=None,
        ip_address=None,
        auth_method="oauth",
    )
    other = await user_session.issue_session_tokens(
        db_session,
        user_id=user.id,
        extra_claims=None,
        user_agent=None,
        ip_address=None,
        auth_method="oauth",
    )

    revoked_count = await user_session.revoke_others(db_session, user.id, current.session.id)

    assert revoked_count == 1
    assert current.session.revoked_at is None
    assert other.session.revoked_at is not None


async def test_register_active_token_does_not_wait_for_stalled_redis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class SlowRedis:
        async def sadd(self, *_args: object) -> None:
            await asyncio.sleep(2)

    monkeypatch.setattr(security, "redis_client", SlowRedis())

    await asyncio.wait_for(
        security.register_active_token("user-123", "jti-123", ttl_seconds=60),
        timeout=1.5,
    )


async def test_revoke_user_fails_closed_when_redis_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnavailableRedis:
        async def smembers(self, *_args: object) -> set[str]:
            raise ConnectionError("redis unavailable")

    monkeypatch.setattr(security, "redis_client", UnavailableRedis())

    with pytest.raises(RedisUnavailableError, match="revoking user tokens"):
        await revoke_user("user-123")


@pytest.mark.parametrize(
    "failure", [socket.gaierror("name resolution failed"), ConnectionRefusedError()]
)
async def test_blacklist_check_handles_redis_network_failures(
    monkeypatch: pytest.MonkeyPatch, failure: OSError
) -> None:
    class UnavailableRedis:
        async def exists(self, *_args: object) -> bool:
            raise failure

    monkeypatch.setattr(security, "redis_client", UnavailableRedis())
    token = create_access_token("user-network-failure")

    assert await security.is_blacklisted(token) is False
    with pytest.raises(RedisUnavailableError, match="checking token blacklist"):
        await security.is_blacklisted(token, fail_closed=True, raise_on_unavailable=True)


@pytest.mark.parametrize(
    "failure", [socket.gaierror("name resolution failed"), ConnectionRefusedError()]
)
async def test_session_check_handles_redis_network_failures(
    monkeypatch: pytest.MonkeyPatch, failure: OSError
) -> None:
    class UnavailableRedis:
        async def exists(self, *_args: object) -> bool:
            raise failure

    monkeypatch.setattr(security, "redis_client", UnavailableRedis())

    assert await security.is_session_revoked("session-network-failure") is False
    with pytest.raises(RedisUnavailableError, match="checking session revocation"):
        await security.is_session_revoked("session-network-failure", fail_closed=True)
