from __future__ import annotations

import pytest

from api.core.config import settings
from api.models.user import User
from api.routers.auth import _email_can_login


def test_external_email_can_login_when_external_users_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", True)

    assert _email_can_login("stranger@gmail.com") is True


def test_school_domain_email_can_login_when_external_users_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", False)

    assert _email_can_login("g0410532@hchs.hc.edu.tw") is True


def test_external_email_blocked_when_external_users_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", False)

    assert _email_can_login("stranger@gmail.com") is False


def test_existing_user_with_external_login_permission_can_use_external_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", False)
    user = User(
        email="chris20090731@gmail.com",
        display_name="Chris",
        is_active=True,
        is_verified=True,
        allow_external_login=True,
    )

    assert _email_can_login(user.email, user) is True


def test_superuser_without_external_login_permission_cannot_bypass_email_domain_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", False)
    user = User(
        email="admin@gmail.com",
        display_name="Admin",
        is_active=True,
        is_verified=True,
        is_superuser=True,
        allow_external_login=False,
    )

    assert _email_can_login(user.email, user) is False


def test_inactive_user_cannot_use_external_login_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", False)
    user = User(
        email="disabled-admin@gmail.com",
        display_name="Disabled Admin",
        is_active=False,
        is_verified=True,
        allow_external_login=True,
    )

    assert _email_can_login(user.email, user) is False
