"""JWT 安全機制單元測試"""

import pytest
from jwt.exceptions import InvalidTokenError

from api.core.security import create_access_token, create_refresh_token, decode_token


def test_create_and_decode_access_token() -> None:
    """測試 Access Token 的建立與解碼"""
    token = create_access_token(subject="user-123")
    payload = decode_token(token)

    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"
    assert "exp" in payload
    assert "iat" in payload


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


def test_access_token_has_extra_claims() -> None:
    """測試 Access Token 可附帶額外 Claims"""
    token = create_access_token(subject="user-789", extra_claims={"role": "admin"})
    payload = decode_token(token)

    assert payload["role"] == "admin"
    assert payload["sub"] == "user-789"
