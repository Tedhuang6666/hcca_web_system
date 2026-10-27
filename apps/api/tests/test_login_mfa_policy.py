"""OAuth 登入應依明確啟用的 2FA 設定決定是否要求第二因素。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.security import decode_token
from api.models.discord_account import DiscordAccountLink
from api.models.passkey import PasskeyCredential
from api.services import discord_bot as discord_bot_svc
from api.services import mfa as mfa_svc


@pytest.mark.parametrize("login_method", ["google", "one_tap", "discord", "discord_open"])
@pytest.mark.parametrize("has_passkey", [False, True], ids=["no-passkey", "passkey"])
@pytest.mark.parametrize("mfa_state", ["disabled", "pending", "enabled"])
async def test_login_requires_explicit_mfa_activation(
    client: AsyncClient,
    db_session: AsyncSession,
    make_user: Callable[..., Any],
    monkeypatch: pytest.MonkeyPatch,
    login_method: str,
    has_passkey: bool,
    mfa_state: str,
) -> None:
    import api.routers.auth as auth_module

    enabled = mfa_state == "enabled"
    secret = mfa_svc.encrypt_mfa_secret(mfa_svc.generate_totp_secret())
    user = await make_user(
        google_sub="login-mfa-policy-sub",
        mfa_enabled=enabled,
        mfa_secret=secret if enabled else None,
        mfa_pending_secret=secret if mfa_state == "pending" else None,
    )
    if has_passkey:
        db_session.add(
            PasskeyCredential(
                user_id=user.id,
                credential_id=b"login-mfa-policy-credential",
                public_key=b"public-key",
            )
        )
        await db_session.flush()

    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", True)
    userinfo = {
        "sub": user.google_sub,
        "email": user.email,
        "email_verified": True,
        "name": user.display_name,
    }
    if login_method == "google":
        monkeypatch.setattr(
            auth_module.google,
            "authorize_access_token",
            AsyncMock(return_value={"userinfo": userinfo}),
        )
        response = await client.get("/auth/google/callback", follow_redirects=False)
    elif login_method == "one_tap":
        monkeypatch.setattr(
            auth_module.google_id_token, "verify_oauth2_token", lambda *args: userinfo
        )
        response = await client.post("/auth/google/one-tap", json={"credential": "test-token"})
    elif login_method == "discord":
        discord_id = "123456789012345678"
        db_session.add(DiscordAccountLink(user_id=user.id, discord_user_id=discord_id))
        await db_session.flush()
        monkeypatch.setattr(
            auth_module.discord, "authorize_access_token", AsyncMock(return_value={})
        )
        monkeypatch.setattr(
            auth_module.discord,
            "get",
            AsyncMock(
                return_value=Response(
                    200,
                    json={"id": discord_id},
                    request=Request("GET", "https://discord.com/api/users/@me"),
                )
            ),
        )
        response = await client.get("/auth/discord/callback", follow_redirects=False)
    else:
        url = await discord_bot_svc.create_open_url(user.id, "/dashboard")
        token = url.rsplit("token=", 1)[-1]
        response = await client.get(
            "/discord/open", params={"token": token}, follow_redirects=False
        )

    if login_method == "one_tap":
        assert response.status_code == 200
        assert response.json()["mfa_required"] is enabled
    else:
        assert response.status_code in (302, 307)
        expected_path = (
            "/auth/mfa?"
            if enabled
            else ("/dashboard" if login_method == "discord_open" else "/auth/callback?")
        )
        assert expected_path in response.headers["location"]

    if enabled:
        assert settings.ACCESS_TOKEN_COOKIE_NAME not in response.cookies
        assert settings.REFRESH_TOKEN_COOKIE_NAME not in response.cookies
        challenge_response = await client.get("/auth/mfa/exchange-challenge")
        assert challenge_response.status_code == 200
        challenge = decode_token(challenge_response.json()["challenge"])
        assert challenge["type"] == "mfa_challenge"
        assert challenge["sub"] == str(user.id)
        assert challenge_response.json()["passkey_available"] is has_passkey
    else:
        assert settings.ACCESS_TOKEN_COOKIE_NAME in response.cookies
        assert settings.REFRESH_TOKEN_COOKIE_NAME in response.cookies
        access = decode_token(response.cookies[settings.ACCESS_TOKEN_COOKIE_NAME])
        assert access["type"] == "access"
        assert access["sub"] == str(user.id)
        challenge_response = await client.get("/auth/mfa/exchange-challenge")
        assert challenge_response.status_code == 404
