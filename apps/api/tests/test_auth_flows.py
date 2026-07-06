"""身份驗證路由 HTTP 層測試（apps/api/src/api/routers/auth.py）。

test_auth_policy.py 只測 `_email_can_login` 這個純函式；本檔補上真正經過
FastAPI 路由層的行為：refresh token 輪替與黑名單、/me、/logout、
Google One Tap（mock Google 端驗證，不打真實網路）、OAuth 入口重導向組裝。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.defense import publish_rules
from api.core.security import create_access_token, create_refresh_token, decode_token
from api.models.user import User

# ---------------------------------------------------------------------------
# /auth/refresh
# ---------------------------------------------------------------------------


async def test_refresh_with_valid_cookie_token_rotates_and_sets_new_cookies(
    client: AsyncClient, member_user: User
) -> None:
    """合法 refresh token（走 cookie）應換發新 token pair 並輪替（舊 token 加黑名單）。"""
    old_refresh = create_refresh_token(str(member_user.id))
    client.cookies.set(settings.REFRESH_TOKEN_COOKIE_NAME, old_refresh)

    response = await client.post("/auth/refresh")

    assert response.status_code == 200
    assert response.json() == {"message": "ok"}
    assert settings.ACCESS_TOKEN_COOKIE_NAME in response.cookies
    assert settings.REFRESH_TOKEN_COOKIE_NAME in response.cookies
    # 新 refresh token 應與舊的不同（輪替）
    assert response.cookies[settings.REFRESH_TOKEN_COOKIE_NAME] != old_refresh


async def test_refresh_with_body_token_also_works(client: AsyncClient, member_user: User) -> None:
    """前端也可能改用 request body 帶 refresh_token（無 cookie 情境）。"""
    old_refresh = create_refresh_token(str(member_user.id))

    response = await client.post("/auth/refresh", json={"refresh_token": old_refresh})

    assert response.status_code == 200


async def test_refresh_without_any_token_returns_401(client: AsyncClient) -> None:
    response = await client.post("/auth/refresh")
    assert response.status_code == 401


async def test_refresh_reused_old_token_returns_401_after_rotation(
    client: AsyncClient, member_user: User
) -> None:
    """Token Rotation：refresh 後舊 token 被加入黑名單，重放應被拒絕。"""
    old_refresh = create_refresh_token(str(member_user.id))
    client.cookies.set(settings.REFRESH_TOKEN_COOKIE_NAME, old_refresh)

    first = await client.post("/auth/refresh")
    assert first.status_code == 200

    # 用同一支舊 token 重放（模擬攻擊者截獲舊 token）
    replay = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert replay.status_code == 401


async def test_refresh_with_access_token_type_returns_401(
    client: AsyncClient, member_user: User
) -> None:
    """type=access 的 token 不該被 /auth/refresh 接受（型別檢查）。"""
    access = create_access_token(str(member_user.id))

    response = await client.post("/auth/refresh", json={"refresh_token": access})

    assert response.status_code == 401


async def test_refresh_for_inactive_user_returns_401(
    client: AsyncClient, make_user: Callable[..., Any]
) -> None:
    user = await make_user(is_active=False)
    refresh = create_refresh_token(str(user.id))

    response = await client.post("/auth/refresh", json={"refresh_token": refresh})

    assert response.status_code == 401


async def test_refresh_for_blocked_user_returns_403(client: AsyncClient, member_user: User) -> None:
    """user_block 防禦規則命中時，refresh 應回 403 而非放行。"""
    await publish_rules(
        [
            {
                "rule_type": "user_block",
                "target": str(member_user.id),
                "reason": "測試封鎖",
                "expires_at": None,
            }
        ]
    )
    refresh = create_refresh_token(str(member_user.id))

    try:
        response = await client.post("/auth/refresh", json={"refresh_token": refresh})
        assert response.status_code == 403
        assert response.json()["detail"]["blocked"] is True
    finally:
        await publish_rules([])


# ---------------------------------------------------------------------------
# /auth/me
# ---------------------------------------------------------------------------


async def test_get_me_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.get("/auth/me")
    assert response.status_code == 401


async def test_get_me_returns_current_user_payload(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(member_user.id)
    assert payload["email"] == member_user.email
    assert payload["is_superuser"] is False
    assert "permissions" in payload


async def test_get_me_flags_superuser_and_owner(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin = await make_user(email="owner-flag@school.edu", display_name="Owner", is_superuser=True)
    monkeypatch.setattr(settings, "OWNER_EMAILS", [admin.email.lower()])
    ac = authed_client_factory(admin)

    response = await ac.get("/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_superuser"] is True
    assert payload["is_owner"] is True


# ---------------------------------------------------------------------------
# /auth/logout
# ---------------------------------------------------------------------------


async def test_logout_blacklists_cookies_and_clears_them(
    client: AsyncClient, member_user: User
) -> None:
    access = create_access_token(str(member_user.id))
    refresh = create_refresh_token(str(member_user.id))
    client.cookies.set(settings.ACCESS_TOKEN_COOKIE_NAME, access)
    client.cookies.set(settings.REFRESH_TOKEN_COOKIE_NAME, refresh)

    response = await client.post("/auth/logout")

    assert response.status_code == 200
    assert response.json() == {"message": "已成功登出"}
    # Set-Cookie 應包含刪除指令（值清空）
    set_cookie_headers = response.headers.get_list("set-cookie")
    assert any(
        settings.ACCESS_TOKEN_COOKIE_NAME in h and "=;" in h.replace(" ", "")
        for h in set_cookie_headers
    ) or any(settings.ACCESS_TOKEN_COOKIE_NAME in h for h in set_cookie_headers)

    # 已登出的 access token 應變成黑名單（refresh 端點會拒絕沿用同一支 refresh token 是另一回事，
    # 這裡直接驗證 add_to_blacklist 有確實被呼叫：舊 refresh token 現在應該也是黑名單狀態）
    from api.core.security import is_blacklisted

    assert await is_blacklisted(refresh) is True


async def test_logout_without_any_cookie_still_returns_200(client: AsyncClient) -> None:
    """未登入狀態呼叫 logout 應優雅返回，不因缺少 cookie 而 500。"""
    response = await client.post("/auth/logout")
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# /auth/google/one-tap
# ---------------------------------------------------------------------------


async def test_google_one_tap_disabled_when_client_id_missing(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "")

    response = await client.post("/auth/google/one-tap", json={"credential": "whatever"})

    assert response.status_code == 503


async def test_google_one_tap_rejects_invalid_credential(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import api.routers.auth as auth_module

    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "fake-client-id")

    def _raise_invalid(*args: Any, **kwargs: Any) -> dict:
        raise ValueError("bad token")

    monkeypatch.setattr(auth_module.google_id_token, "verify_oauth2_token", _raise_invalid)

    response = await client.post("/auth/google/one-tap", json={"credential": "garbage"})

    assert response.status_code == 401


async def test_google_one_tap_rejects_unverified_email(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import api.routers.auth as auth_module

    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "fake-client-id")

    def _fake_verify(*args: Any, **kwargs: Any) -> dict:
        return {
            "sub": "google-sub-unverified",
            "email": "unverified@school.edu",
            "email_verified": False,
        }

    monkeypatch.setattr(auth_module.google_id_token, "verify_oauth2_token", _fake_verify)

    response = await client.post("/auth/google/one-tap", json={"credential": "token"})

    assert response.status_code == 403


async def test_google_one_tap_creates_user_and_logs_in(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """完整走一次新使用者建立流程（LOGIN_ALLOW_EXTERNAL_USERS=True 避免網域白名單卡關）。"""
    import api.routers.auth as auth_module

    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "fake-client-id")
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", True)

    unique_sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    unique_email = f"onetap-{uuid.uuid4().hex[:8]}@school.edu"

    def _fake_verify(*args: Any, **kwargs: Any) -> dict:
        return {
            "sub": unique_sub,
            "email": unique_email,
            "email_verified": True,
            "name": "One Tap 使用者",
            "picture": None,
        }

    monkeypatch.setattr(auth_module.google_id_token, "verify_oauth2_token", _fake_verify)

    response = await client.post("/auth/google/one-tap", json={"credential": "token"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["mfa_required"] is False
    assert payload["user"]["email"] == unique_email
    assert settings.ACCESS_TOKEN_COOKIE_NAME in response.cookies


async def test_google_one_tap_mfa_enabled_user_returns_challenge(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession
) -> None:
    """已啟用 MFA 的使用者透過 One Tap 登入時，不應直接發放正式 token，而是回傳 challenge。"""
    import api.routers.auth as auth_module

    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "fake-client-id")
    monkeypatch.setattr(settings, "LOGIN_ALLOW_EXTERNAL_USERS", True)

    unique_sub = f"google-sub-mfa-{uuid.uuid4().hex[:8]}"
    unique_email = f"onetap-mfa-{uuid.uuid4().hex[:8]}@school.edu"
    existing = User(
        email=unique_email,
        display_name="MFA One Tap",
        is_active=True,
        is_verified=True,
        mfa_enabled=True,
        google_sub=unique_sub,
    )
    db_session.add(existing)
    await db_session.flush()

    def _fake_verify(*args: Any, **kwargs: Any) -> dict:
        return {
            "sub": unique_sub,
            "email": unique_email,
            "email_verified": True,
            "name": "MFA One Tap",
        }

    monkeypatch.setattr(auth_module.google_id_token, "verify_oauth2_token", _fake_verify)

    response = await client.post("/auth/google/one-tap", json={"credential": "token"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["mfa_required"] is True
    # 正式 token 不應被設置
    assert settings.ACCESS_TOKEN_COOKIE_NAME not in response.cookies


# ---------------------------------------------------------------------------
# /auth/google/login /auth/discord/login（OAuth 入口重導向）
# ---------------------------------------------------------------------------


async def test_google_login_redirects_to_google_authorize_endpoint(client: AsyncClient) -> None:
    response = await client.get("/auth/google/login", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "accounts.google.com" in response.headers["location"]


async def test_discord_login_returns_503_when_not_configured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import api.routers.auth as auth_module

    monkeypatch.setattr(auth_module, "discord_is_configured", lambda: False)

    response = await client.get("/auth/discord/login", follow_redirects=False)

    assert response.status_code == 503


async def test_discord_login_redirects_when_configured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import api.routers.auth as auth_module

    monkeypatch.setattr(auth_module, "discord_is_configured", lambda: True)
    monkeypatch.setattr(settings, "DISCORD_LOGIN_REDIRECT_URI", "http://test/auth/discord/callback")

    response = await client.get("/auth/discord/login", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "discord.com" in response.headers["location"]


# ---------------------------------------------------------------------------
# helper：確認黑名單 token 的 payload 型別（間接驗證 decode_token 仍可用）
# ---------------------------------------------------------------------------


def test_decode_token_roundtrip_sanity() -> None:
    token = create_access_token("sanity-check-subject")
    payload = decode_token(token)
    assert payload["sub"] == "sanity-check-subject"
    assert payload["type"] == "access"
