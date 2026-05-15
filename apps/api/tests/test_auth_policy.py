from __future__ import annotations

from api.models.user import User
from api.routers.auth import _email_can_login


def test_existing_user_with_external_login_permission_can_use_external_email() -> None:
    user = User(
        email="chris20090731@gmail.com",
        display_name="Chris",
        is_active=True,
        is_verified=True,
        allow_external_login=True,
    )

    assert _email_can_login(user.email, user) is True


def test_superuser_without_external_login_permission_cannot_bypass_email_domain_policy() -> None:
    user = User(
        email="admin@gmail.com",
        display_name="Admin",
        is_active=True,
        is_verified=True,
        is_superuser=True,
        allow_external_login=False,
    )

    assert _email_can_login(user.email, user) is False


def test_inactive_user_cannot_use_external_login_permission() -> None:
    user = User(
        email="disabled-admin@gmail.com",
        display_name="Disabled Admin",
        is_active=False,
        is_verified=True,
        allow_external_login=True,
    )

    assert _email_can_login(user.email, user) is False
