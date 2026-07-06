"""API Key 管理路由測試（apps/api/src/api/routers/api_keys.py）。

涵蓋 admin_list / admin_create / admin_get / admin_revoke 四個端點，
含 api_key:admin 權限檢查與明文 key 一次性回傳行為。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from httpx import AsyncClient

from api.models.user import User


def _authed(factory: Callable[[User], AsyncClient], user: User) -> AsyncClient:
    import secrets

    ac = factory(user)
    token = secrets.token_urlsafe(32)
    ac.cookies.set("csrf_token", token)
    ac._csrf_token = token
    return ac


# ---------------------------------------------------------------------------
# GET /api-keys
# ---------------------------------------------------------------------------


async def test_list_api_keys_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.get("/api-keys")
    assert response.status_code == 403


async def test_list_api_keys_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.get("/api-keys")
    assert response.status_code == 401


async def test_superuser_can_list_api_keys(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get("/api-keys")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


# ---------------------------------------------------------------------------
# POST /api-keys
# ---------------------------------------------------------------------------


async def test_create_api_key_returns_plaintext_once(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)

    response = await ac.post(
        "/api-keys",
        json={"name": "圖書館整合", "scopes": ["read:announcements"], "rate_limit_per_minute": 30},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["key_plaintext"].startswith("hcca_")
    assert payload["api_key"]["name"] == "圖書館整合"
    assert payload["api_key"]["scopes"] == ["read:announcements"]
    assert payload["api_key"]["is_active"] is True


async def test_create_api_key_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)

    response = await ac.post("/api-keys", json={"name": "無權限測試"})

    assert response.status_code == 403


async def test_create_api_key_rejects_invalid_name(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)

    response = await ac.post("/api-keys", json={"name": ""})

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /api-keys/{id}
# ---------------------------------------------------------------------------


async def test_get_api_key_by_id(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: Any,
) -> None:
    from api.services import api_key as api_key_svc

    row, _raw = await api_key_svc.create_api_key(
        db_session,
        owner_user_id=admin_user.id,
        name="查詢測試",
        scopes=[],
        rate_limit_per_minute=60,
        expires_at=None,
    )
    await db_session.commit()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get(f"/api-keys/{row.id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(row.id)
    # 明文 key 不應出現在一般查詢回應中
    assert "key_plaintext" not in response.json()


async def test_get_nonexistent_api_key_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get(f"/api-keys/{uuid.uuid4()}")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /api-keys/{id}/revoke
# ---------------------------------------------------------------------------


async def test_revoke_api_key_marks_inactive(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: Any,
) -> None:
    from api.services import api_key as api_key_svc

    row, _raw = await api_key_svc.create_api_key(
        db_session,
        owner_user_id=admin_user.id,
        name="撤銷測試",
        scopes=[],
        rate_limit_per_minute=60,
        expires_at=None,
    )
    await db_session.commit()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/api-keys/{row.id}/revoke", json={"reason": "不再使用"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_active"] is False
    assert payload["revoked_reason"] == "不再使用"


async def test_revoke_nonexistent_api_key_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/api-keys/{uuid.uuid4()}/revoke", json={})
    assert response.status_code == 404


async def test_revoked_api_key_cannot_authenticate(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: Any,
) -> None:
    """撤銷後，find_active_by_raw 應找不到此 key（供 API Key 認證 middleware 使用）。"""
    from api.services import api_key as api_key_svc

    row, raw = await api_key_svc.create_api_key(
        db_session,
        owner_user_id=admin_user.id,
        name="失效測試",
        scopes=[],
        rate_limit_per_minute=60,
        expires_at=None,
    )
    await db_session.commit()

    ac = _authed(authed_client_factory, admin_user)
    revoke_resp = await ac.post(f"/api-keys/{row.id}/revoke", json={})
    assert revoke_resp.status_code == 200

    found = await api_key_svc.find_active_by_raw(db_session, raw)
    assert found is None
