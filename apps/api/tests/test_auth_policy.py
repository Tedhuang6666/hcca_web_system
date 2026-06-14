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


def test_superuser_cannot_bypass_email_domain_policy_without_global_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", False)
    user = User(
        email="admin@gmail.com",
        display_name="Admin",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )

    assert _email_can_login(user.email, user) is False
