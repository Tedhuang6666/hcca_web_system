"""JWT 安全機制單元測試"""

import asyncio
import uuid
from unittest.mock import AsyncMock

import jwt
import pytest
from jwt.exceptions import InvalidTokenError

from api.core import security
from api.core.security import create_access_token, create_refresh_token, decode_token
from api.dependencies import auth as auth_dependency


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


def test_decode_legacy_token_with_standard_claims_is_supported(monkeypatch: pytest.MonkeyPatch) -> None:
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


async def test_v2_access_token_snapshot_does_not_query_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()
    token = create_access_token(
        str(user_id),
        extra_claims={
            "user": {
                "email": "member@school.edu",
                "display_name": "成員",
                "is_active": True,
                "is_verified": True,
                "is_superuser": False,
            }
        },
        session_id=str(uuid.uuid4()),
    )
    db = AsyncMock()
    monkeypatch.setattr(auth_dependency, "is_blacklisted", AsyncMock(return_value=False))
    monkeypatch.setattr(auth_dependency, "is_session_revoked", AsyncMock(return_value=False))

    user = await auth_dependency._user_from_access_token(token, db)

    assert user is not None
    assert user.id == user_id
    assert user.email == "member@school.edu"
    db.execute.assert_not_awaited()


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
