"""Google Tasks 整合路由測試（/user/google-tasks）。

真正的 Google OAuth／Tasks API 呼叫一律 mock（不打真實網路）：
- api.core.oauth.google_tasks（authlib client）的 authorize_redirect / authorize_access_token
- api.services.google_tasks_service 的 push_work_item / pull_from_google

/status、/disconnect、/sync 三個端點不牽涉真正的 OAuth 往返，直接用 db_session 建立
UserGoogleTasksConfig 測試；access_token 欄位是加密欄位，凡是不需要解密內容的測試
（is_connected 只看 _refresh_token_enc 是否有值）直接寫入 private column 即可，避免
另外設定 FIELD_ENCRYPTION_KEYS。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from cryptography.fernet import Fernet
from fastapi.responses import RedirectResponse
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import field_crypto
from api.models.user import User
from api.models.user_google_tasks import UserGoogleTasksConfig
from api.services import google_tasks_service as gtask_svc


@pytest.fixture(autouse=True)
def _reset_cipher_cache():
    """避免不同測試對 FIELD_ENCRYPTION_KEYS 的 monkeypatch 互相汙染。"""
    field_crypto.reset_cipher_cache()
    yield
    field_crypto.reset_cipher_cache()


async def _make_config(
    db_session: AsyncSession,
    user: User,
    *,
    connected: bool = True,
    is_active: bool = True,
    sync_enabled: bool = True,
) -> UserGoogleTasksConfig:
    config = UserGoogleTasksConfig(user_id=user.id, is_active=is_active, sync_enabled=sync_enabled)
    db_session.add(config)
    await db_session.flush()
    if connected:
        # 直接寫入加密欄位本身（任意非空字串即代表「已連結」），避免需要設定
        # FIELD_ENCRYPTION_KEYS 才能通過 hybrid_property setter。
        config._refresh_token_enc = "encrypted-refresh-token-placeholder"
    await db_session.flush()
    return config


# ── GET /status ──────────────────────────────────────────────────────────────


async def test_get_status_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.get("/user/google-tasks/status")
    assert response.status_code == 401


async def test_get_status_returns_not_connected_when_no_config(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/user/google-tasks/status")

    assert response.status_code == 200
    body = response.json()
    assert body["is_connected"] is False
    assert body["authorized_email"] is None


async def test_get_status_returns_connected_details(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    config = await _make_config(db_session, member_user)
    config.authorized_email = "member@gmail.com"
    config.last_sync_at = datetime.now(UTC)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    response = await ac.get("/user/google-tasks/status")

    assert response.status_code == 200
    body = response.json()
    assert body["is_connected"] is True
    assert body["authorized_email"] == "member@gmail.com"
    assert body["sync_enabled"] is True


async def test_get_status_ignores_inactive_config(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    """已被停用（is_active=False）的連結不應視為已連結。"""
    await _make_config(db_session, member_user, is_active=False)

    ac = authed_client_factory(member_user)
    response = await ac.get("/user/google-tasks/status")

    assert response.status_code == 200
    assert response.json()["is_connected"] is False


# ── DELETE /disconnect ───────────────────────────────────────────────────────


async def test_disconnect_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.delete("/user/google-tasks/disconnect")
    assert response.status_code == 401


async def test_disconnect_missing_config_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.delete("/user/google-tasks/disconnect")
    assert response.status_code == 404


async def test_disconnect_success_deactivates_config(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    config = await _make_config(db_session, member_user)

    ac = authed_client_factory(member_user)
    response = await ac.delete("/user/google-tasks/disconnect")

    assert response.status_code == 204
    await db_session.refresh(config)
    assert config.is_active is False
    assert config.sync_enabled is False


# ── POST /sync ───────────────────────────────────────────────────────────────


async def test_manual_sync_missing_config_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.post("/user/google-tasks/sync")
    assert response.status_code == 404


async def test_manual_sync_success_returns_counts(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    await _make_config(db_session, member_user)

    with (
        patch.object(gtask_svc, "push_work_item", AsyncMock(return_value="google-task-1")),
        patch.object(
            gtask_svc,
            "pull_from_google",
            AsyncMock(return_value={"created": 2, "skipped": 1, "errors": 0}),
        ),
    ):
        ac = authed_client_factory(member_user)
        response = await ac.post("/user/google-tasks/sync")

    assert response.status_code == 200
    body = response.json()
    assert body["pulled_created"] == 2
    assert body["pulled_skipped"] == 1
    assert body["errors"] == 0


async def test_manual_sync_auth_error_returns_401(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    """Google Tasks 授權過期時應回傳 401，讓前端引導重新授權。"""
    await _make_config(db_session, member_user)

    with patch.object(
        gtask_svc,
        "pull_from_google",
        AsyncMock(side_effect=gtask_svc.GoogleTasksAuthError("token 已過期")),
    ):
        ac = authed_client_factory(member_user)
        response = await ac.post("/user/google-tasks/sync")

    assert response.status_code == 401


async def test_manual_sync_api_error_returns_502(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    """Google Tasks API 呼叫失敗（非授權問題）應回傳 502。"""
    await _make_config(db_session, member_user)

    with patch.object(
        gtask_svc,
        "pull_from_google",
        AsyncMock(side_effect=gtask_svc.GoogleTasksApiError("Google 伺服器錯誤")),
    ):
        ac = authed_client_factory(member_user)
        response = await ac.post("/user/google-tasks/sync")

    assert response.status_code == 502


# ── GET /authorize、/callback ────────────────────────────────────────────────


async def test_authorize_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.get("/user/google-tasks/authorize")
    assert response.status_code == 401


async def test_authorize_redirects_to_google_oauth(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    """已登入使用者發起授權時，應把 user_id 存進 session 並轉交 authlib 產生轉址。"""
    ac = authed_client_factory(member_user)

    fake_redirect = RedirectResponse(url="https://accounts.google.com/o/oauth2/v2/auth?fake=1")
    with patch(
        "api.core.oauth.google_tasks.authorize_redirect",
        AsyncMock(return_value=fake_redirect),
    ):
        response = await ac.get("/user/google-tasks/authorize", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "accounts.google.com" in response.headers["location"]


async def test_callback_without_session_redirects_with_session_expired_error(
    client: AsyncClient,
) -> None:
    """未經過 /authorize（沒有 session）直接打 callback，應轉址帶 session_expired 錯誤。"""
    response = await client.get("/user/google-tasks/callback", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "error=session_expired" in response.headers["location"]


async def test_callback_oauth_error_redirects_with_oauth_error(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    """authlib 拋 OAuthError（如使用者取消授權）時應轉址帶 oauth_error。"""
    from authlib.integrations.base_client import OAuthError

    ac = authed_client_factory(member_user)
    fake_redirect = RedirectResponse(url="https://accounts.google.com/o/oauth2/v2/auth?fake=1")
    with patch(
        "api.core.oauth.google_tasks.authorize_redirect",
        AsyncMock(return_value=fake_redirect),
    ):
        await ac.get("/user/google-tasks/authorize", follow_redirects=False)

    with patch(
        "api.core.oauth.google_tasks.authorize_access_token",
        AsyncMock(side_effect=OAuthError(error="access_denied")),
    ):
        response = await ac.get("/user/google-tasks/callback", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "error=oauth_error" in response.headers["location"]


async def test_callback_success_creates_config_and_redirects_connected(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """成功回呼應建立（或更新）UserGoogleTasksConfig 並轉址 connected=true。"""
    from api.core.config import settings

    monkeypatch.setattr(
        settings, "FIELD_ENCRYPTION_KEYS", [Fernet.generate_key().decode()], raising=False
    )
    field_crypto.reset_cipher_cache()

    ac = authed_client_factory(member_user)
    fake_redirect = RedirectResponse(url="https://accounts.google.com/o/oauth2/v2/auth?fake=1")
    with patch(
        "api.core.oauth.google_tasks.authorize_redirect",
        AsyncMock(return_value=fake_redirect),
    ):
        await ac.get("/user/google-tasks/authorize", follow_redirects=False)

    token_data = {
        "access_token": "at-123",
        "refresh_token": "rt-123",
        "expires_at": datetime.now(UTC).timestamp() + 3600,
        "userinfo": {"email": "member@gmail.com"},
    }
    with patch(
        "api.core.oauth.google_tasks.authorize_access_token",
        AsyncMock(return_value=token_data),
    ):
        response = await ac.get("/user/google-tasks/callback", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "connected=true" in response.headers["location"]

    result = await db_session.execute(
        UserGoogleTasksConfig.__table__.select().where(
            UserGoogleTasksConfig.user_id == member_user.id
        )
    )
    row = result.mappings().one()
    assert row["authorized_email"] == "member@gmail.com"
    assert row["is_active"] is True


async def test_callback_without_encryption_keys_redirects_with_error(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FIELD_ENCRYPTION_KEYS 未設定時，callback 應優雅轉址而非 500。"""
    from api.core.config import settings

    monkeypatch.setattr(settings, "FIELD_ENCRYPTION_KEYS", [], raising=False)
    field_crypto.reset_cipher_cache()

    ac = authed_client_factory(member_user)
    fake_redirect = RedirectResponse(url="https://accounts.google.com/o/oauth2/v2/auth?fake=1")
    with patch(
        "api.core.oauth.google_tasks.authorize_redirect",
        AsyncMock(return_value=fake_redirect),
    ):
        await ac.get("/user/google-tasks/authorize", follow_redirects=False)

    token_data = {
        "access_token": "at-123",
        "refresh_token": "rt-123",
        "expires_at": None,
        "userinfo": {"email": "member@gmail.com"},
    }
    with patch(
        "api.core.oauth.google_tasks.authorize_access_token",
        AsyncMock(return_value=token_data),
    ):
        response = await ac.get("/user/google-tasks/callback", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "error=encryption_not_configured" in response.headers["location"]
    uuid.UUID(str(member_user.id))  # sanity：member_user 型別未被誤用
