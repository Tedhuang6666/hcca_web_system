"""Feature Flag 路由 HTTP 層測試（apps/api/src/api/routers/feature_flags.py）。

test_feature_flag.py 只測 service 層 is_enabled/create_flag/update_flag/archive_flag；
本檔補上經過 FastAPI 路由層的行為：/me 單一與批次評估、admin CRUD 與
feature_flag:admin 權限檢查。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.feature_flag import FeatureFlag
from api.models.user import User


def _authed(factory: Callable[[User], AsyncClient], user: User) -> AsyncClient:
    import secrets

    ac = factory(user)
    token = secrets.token_urlsafe(32)
    ac.cookies.set("csrf_token", token)
    ac._csrf_token = token
    return ac


# ---------------------------------------------------------------------------
# GET /feature-flags/me/{key} + /feature-flags/me
# ---------------------------------------------------------------------------


async def test_evaluate_for_me_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.get("/feature-flags/me/some-flag")
    assert response.status_code == 401


async def test_evaluate_for_me_returns_false_for_unknown_flag(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.get("/feature-flags/me/does-not-exist")

    assert response.status_code == 200
    assert response.json() == {"key": "does-not-exist", "enabled": False}


async def test_evaluate_for_me_returns_true_for_globally_enabled_flag(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    flag = FeatureFlag(key=f"global-on-{uuid.uuid4().hex[:6]}", is_globally_enabled=True)
    db_session.add(flag)
    await db_session.flush()

    ac = _authed(authed_client_factory, member_user)
    response = await ac.get(f"/feature-flags/me/{flag.key}")

    assert response.status_code == 200
    assert response.json()["enabled"] is True


async def test_evaluate_all_for_me_skips_archived_flags(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    from datetime import UTC, datetime

    active_flag = FeatureFlag(key=f"active-{uuid.uuid4().hex[:6]}", is_globally_enabled=True)
    archived_flag = FeatureFlag(
        key=f"archived-{uuid.uuid4().hex[:6]}",
        is_globally_enabled=True,
        archived_at=datetime.now(UTC),
    )
    db_session.add_all([active_flag, archived_flag])
    await db_session.flush()

    ac = _authed(authed_client_factory, member_user)
    response = await ac.get("/feature-flags/me")

    assert response.status_code == 200
    keys = {row["key"] for row in response.json()}
    assert active_flag.key in keys
    assert archived_flag.key not in keys


# ---------------------------------------------------------------------------
# GET/POST/PATCH/POST(archive) /feature-flags（admin）
# ---------------------------------------------------------------------------


async def test_admin_list_flags_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.get("/feature-flags")
    assert response.status_code == 403


async def test_superuser_can_list_flags(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get("/feature-flags")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_admin_create_flag(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    key = f"new_flag_{uuid.uuid4().hex[:6]}"

    response = await ac.post("/feature-flags", json={"key": key, "description": "測試旗標"})

    assert response.status_code == 201
    payload = response.json()
    assert payload["key"] == key
    assert payload["is_globally_enabled"] is False


async def test_admin_create_duplicate_flag_returns_409(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    key = f"dup_flag_{uuid.uuid4().hex[:6]}"

    first = await ac.post("/feature-flags", json={"key": key, "description": "第一次"})
    assert first.status_code == 201

    second = await ac.post("/feature-flags", json={"key": key, "description": "第二次"})
    assert second.status_code == 409


async def test_admin_create_flag_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.post("/feature-flags", json={"key": "no_perm_flag"})
    assert response.status_code == 403


async def test_admin_update_flag(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    flag = FeatureFlag(key=f"update-me-{uuid.uuid4().hex[:6]}")
    db_session.add(flag)
    await db_session.flush()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.patch(
        f"/feature-flags/{flag.id}",
        json={"is_globally_enabled": True, "percentage_rollout": 50},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_globally_enabled"] is True
    assert payload["percentage_rollout"] == 50


async def test_admin_update_nonexistent_flag_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.patch(f"/feature-flags/{uuid.uuid4()}", json={"is_globally_enabled": True})
    assert response.status_code == 404


async def test_admin_archive_flag(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    flag = FeatureFlag(key=f"archive-me-{uuid.uuid4().hex[:6]}")
    db_session.add(flag)
    await db_session.flush()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/feature-flags/{flag.id}/archive")

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None


async def test_admin_archive_nonexistent_flag_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/feature-flags/{uuid.uuid4()}/archive")
    assert response.status_code == 404
