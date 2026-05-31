"""Admin impersonation token + guard 測試。Phase C3。"""

from __future__ import annotations

import uuid

import pytest

from api.models.user import User
from api.services import impersonation


def _make_user(*, email: str = "actor@hcca.local", is_superuser: bool = False) -> User:
    return User(
        id=uuid.uuid4(),
        email=email,
        display_name="X",
        is_active=True,
        is_verified=True,
        is_superuser=is_superuser,
    )


def test_create_and_parse_round_trip():
    actor = _make_user(email="admin@hcca.local")
    target = _make_user(email="user@hcca.local")
    token = impersonation.create_impersonation_token(actor=actor, target=target, minutes=5)
    claims = impersonation.parse_impersonation_token(token)
    assert claims is not None
    assert claims["type"] == "impersonation"
    assert claims["sub"] == str(target.id)
    assert claims["imp"] == str(actor.id)
    assert claims["imp_email"] == actor.email


def test_minutes_capped_to_max():
    actor = _make_user()
    target = _make_user(email="t@hcca.local")
    token = impersonation.create_impersonation_token(actor=actor, target=target, minutes=10000)
    # token 仍可解；驗證 exp - iat <= MAX_MINUTES * 60
    claims = impersonation.parse_impersonation_token(token)
    assert claims is not None
    diff = claims["exp"] - claims["iat"]
    assert diff <= impersonation.IMPERSONATION_MAX_MINUTES * 60 + 5


def test_cannot_impersonate_self():
    actor = _make_user()
    with pytest.raises(impersonation.ImpersonationError):
        impersonation.create_impersonation_token(actor=actor, target=actor)


def test_non_superuser_cannot_impersonate_superuser():
    actor = _make_user(email="admin@hcca.local", is_superuser=False)
    target = _make_user(email="owner@hcca.local", is_superuser=True)
    with pytest.raises(impersonation.ImpersonationError):
        impersonation.create_impersonation_token(actor=actor, target=target)


def test_superuser_can_impersonate_superuser():
    actor = _make_user(email="root@hcca.local", is_superuser=True)
    target = _make_user(email="owner@hcca.local", is_superuser=True)
    # 不 raise 即可
    token = impersonation.create_impersonation_token(actor=actor, target=target)
    assert token


def test_parse_returns_none_for_non_impersonation_token():
    from api.core.security import create_access_token

    normal = create_access_token("some-user-id")
    assert impersonation.parse_impersonation_token(normal) is None


def test_parse_returns_none_for_garbage():
    assert impersonation.parse_impersonation_token("not-a-real-token") is None
