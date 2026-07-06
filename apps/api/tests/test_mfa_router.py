"""MFA (TOTP) 路由 HTTP 層測試（apps/api/src/api/routers/mfa.py）。

test_mfa_service.py 只測 service 層（setup_mfa / confirm_mfa / verify_mfa）；
本檔補上經過 FastAPI 路由的行為：狀態查詢、setup→confirm 流程、login/verify
挑戰兌換、備用碼重產生、停用，以及鎖定（連續錯誤驗證碼）行為。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pyotp
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.login_lockout import _failures_key, _lockout_key
from api.core.security import create_access_token, create_mfa_challenge_token, redis_client
from api.models.user import User
from api.services import mfa as mfa_svc


def _authed(factory: Callable[[User], AsyncClient], user: User) -> AsyncClient:
    """回傳已登入且帶有 CSRF token 的 client（authed_client_factory 預設不含 CSRF cookie）。"""
    import secrets

    ac = factory(user)
    token = secrets.token_urlsafe(32)
    ac.cookies.set("csrf_token", token)
    ac._csrf_token = token
    return ac


@pytest.fixture(autouse=True)
async def _cleanup_lockout_keys(member_user: User) -> None:
    yield
    for prefix in (f"mfa:{member_user.id}", f"mfa_login:{member_user.id}"):
        await redis_client.delete(_failures_key(prefix), _lockout_key(prefix))


# ---------------------------------------------------------------------------
# /auth/mfa/status
# ---------------------------------------------------------------------------


async def test_mfa_status_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.get("/auth/mfa/status")
    assert response.status_code == 401


async def test_mfa_status_reports_disabled_by_default(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.get("/auth/mfa/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["mfa_enabled"] is False
    assert payload["has_pending_setup"] is False
    assert payload["backup_code_count"] == 0


# ---------------------------------------------------------------------------
# /auth/mfa/setup + /confirm
# ---------------------------------------------------------------------------


async def test_setup_then_confirm_enables_mfa(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)

    setup_resp = await ac.post("/auth/mfa/setup")
    assert setup_resp.status_code == 200
    setup_payload = setup_resp.json()
    assert len(setup_payload["backup_codes"]) == 8
    secret = setup_payload["secret"]

    code = pyotp.TOTP(secret).now()
    confirm_resp = await ac.post("/auth/mfa/confirm", json={"code": code})
    assert confirm_resp.status_code == 200
    assert confirm_resp.json() == {"message": "2FA 已成功啟用"}

    status_resp = await ac.get("/auth/mfa/status")
    assert status_resp.json()["mfa_enabled"] is True


async def test_setup_when_already_enabled_returns_400(
    authed_client_factory: Callable[[User], AsyncClient], make_user: Callable[..., Any]
) -> None:
    user = await make_user(mfa_enabled=True)
    ac = _authed(authed_client_factory, user)

    response = await ac.post("/auth/mfa/setup")

    assert response.status_code == 400


async def test_confirm_with_wrong_code_returns_400(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    await ac.post("/auth/mfa/setup")

    response = await ac.post("/auth/mfa/confirm", json={"code": "000000"})

    assert response.status_code == 400


# ---------------------------------------------------------------------------
# /auth/mfa/verify（含鎖定行為）
# ---------------------------------------------------------------------------


async def test_verify_with_correct_code_returns_true(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    code = pyotp.TOTP(setup["secret"]).now()
    assert await mfa_svc.confirm_mfa(db_session, user, code)

    ac = _authed(authed_client_factory, user)
    new_code = pyotp.TOTP(setup["secret"]).now()
    response = await ac.post("/auth/mfa/verify", json={"code": new_code})

    assert response.status_code == 200
    assert response.json() == {"verified": True}


async def test_verify_with_wrong_code_returns_401(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    code = pyotp.TOTP(setup["secret"]).now()
    await mfa_svc.confirm_mfa(db_session, user, code)

    ac = _authed(authed_client_factory, user)
    response = await ac.post("/auth/mfa/verify", json={"code": "000000"})

    assert response.status_code == 401


async def test_verify_locks_out_after_repeated_failures(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    """連續輸入錯誤碼達門檻後應被暫時鎖定（429），保護 TOTP 免暴力破解。"""
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    code = pyotp.TOTP(setup["secret"]).now()
    await mfa_svc.confirm_mfa(db_session, user, code)

    ac = _authed(authed_client_factory, user)
    last_response = None
    for _ in range(10):
        last_response = await ac.post("/auth/mfa/verify", json={"code": "000000"})
        if last_response.status_code == 429:
            break

    assert last_response is not None
    assert last_response.status_code == 429


# ---------------------------------------------------------------------------
# /auth/mfa/exchange-challenge
# ---------------------------------------------------------------------------


async def test_exchange_challenge_without_pending_challenge_returns_404(
    client: AsyncClient,
) -> None:
    response = await client.get("/auth/mfa/exchange-challenge")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# /auth/mfa/login/verify
# ---------------------------------------------------------------------------


async def test_login_verify_completes_challenge_and_sets_cookies(
    client: AsyncClient, make_user: Callable[..., Any], db_session: AsyncSession
) -> None:
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    confirm_code = pyotp.TOTP(setup["secret"]).now()
    await mfa_svc.confirm_mfa(db_session, user, confirm_code)

    challenge_token = create_mfa_challenge_token(subject=str(user.id))
    login_code = pyotp.TOTP(setup["secret"]).now()

    response = await client.post(
        "/auth/mfa/login/verify",
        json={"challenge_token": challenge_token, "code": login_code},
    )

    assert response.status_code == 200
    assert response.json() == {"message": "ok"}
    from api.core.config import settings as app_settings

    assert app_settings.ACCESS_TOKEN_COOKIE_NAME in response.cookies


async def test_login_verify_with_garbage_challenge_token_returns_401(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/mfa/login/verify",
        json={"challenge_token": "not-a-real-token", "code": "123456"},
    )
    assert response.status_code == 401


async def test_login_verify_with_normal_access_token_as_challenge_returns_401(
    client: AsyncClient, member_user: User
) -> None:
    """access token 不可冒充 mfa_challenge token 使用。"""
    fake_challenge = create_access_token(str(member_user.id))

    response = await client.post(
        "/auth/mfa/login/verify",
        json={"challenge_token": fake_challenge, "code": "123456"},
    )

    assert response.status_code == 401


async def test_login_verify_with_wrong_code_returns_401(
    client: AsyncClient, make_user: Callable[..., Any], db_session: AsyncSession
) -> None:
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    confirm_code = pyotp.TOTP(setup["secret"]).now()
    await mfa_svc.confirm_mfa(db_session, user, confirm_code)
    challenge_token = create_mfa_challenge_token(subject=str(user.id))

    response = await client.post(
        "/auth/mfa/login/verify",
        json={"challenge_token": challenge_token, "code": "000000"},
    )

    assert response.status_code == 401


async def test_login_verify_for_unknown_user_id_returns_401(client: AsyncClient) -> None:
    challenge_token = create_mfa_challenge_token(subject=str(uuid.uuid4()))

    response = await client.post(
        "/auth/mfa/login/verify",
        json={"challenge_token": challenge_token, "code": "123456"},
    )

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# /auth/mfa/backup-codes/regenerate + /auth/mfa/disable
# ---------------------------------------------------------------------------


async def test_regenerate_backup_codes_with_correct_code(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    confirm_code = pyotp.TOTP(setup["secret"]).now()
    await mfa_svc.confirm_mfa(db_session, user, confirm_code)

    ac = _authed(authed_client_factory, user)
    verify_code = pyotp.TOTP(setup["secret"]).now()
    response = await ac.post("/auth/mfa/backup-codes/regenerate", json={"code": verify_code})

    assert response.status_code == 200
    assert len(response.json()["backup_codes"]) == 8


async def test_regenerate_backup_codes_with_wrong_code_returns_400(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    confirm_code = pyotp.TOTP(setup["secret"]).now()
    await mfa_svc.confirm_mfa(db_session, user, confirm_code)

    ac = _authed(authed_client_factory, user)
    response = await ac.post("/auth/mfa/backup-codes/regenerate", json={"code": "000000"})

    assert response.status_code == 400


async def test_disable_mfa_with_correct_code(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    confirm_code = pyotp.TOTP(setup["secret"]).now()
    await mfa_svc.confirm_mfa(db_session, user, confirm_code)

    ac = _authed(authed_client_factory, user)
    disable_code = pyotp.TOTP(setup["secret"]).now()
    response = await ac.request("DELETE", "/auth/mfa/disable", json={"code": disable_code})

    assert response.status_code == 200
    assert response.json() == {"message": "2FA 已停用"}


async def test_disable_mfa_with_wrong_code_returns_400(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    user = await make_user()
    setup = await mfa_svc.setup_mfa(db_session, user)
    confirm_code = pyotp.TOTP(setup["secret"]).now()
    await mfa_svc.confirm_mfa(db_session, user, confirm_code)

    ac = _authed(authed_client_factory, user)
    response = await ac.request("DELETE", "/auth/mfa/disable", json={"code": "000000"})

    assert response.status_code == 400
