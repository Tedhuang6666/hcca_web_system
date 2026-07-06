"""使用者學籍生命週期路由測試（apps/api/src/api/routers/user_lifecycle.py）。

涵蓋 freeze / archive-alumni / restore 三個動作與狀態查詢端點，
含 system:user_lifecycle 權限檢查與任期 end_date 副作用。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.org import Org, Position, UserPosition
from api.models.user import User


def _authed(factory: Callable[[User], AsyncClient], user: User) -> AsyncClient:
    import secrets

    ac = factory(user)
    token = secrets.token_urlsafe(32)
    ac.cookies.set("csrf_token", token)
    ac._csrf_token = token
    return ac


# ---------------------------------------------------------------------------
# GET /admin/users/{user_id}/lifecycle/status
# ---------------------------------------------------------------------------


async def test_get_status_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.get(f"/admin/users/{uuid.uuid4()}/lifecycle/status")
    assert response.status_code == 401


async def test_get_status_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.get(f"/admin/users/{uuid.uuid4()}/lifecycle/status")
    assert response.status_code == 403


async def test_get_status_for_nonexistent_user_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get(f"/admin/users/{uuid.uuid4()}/lifecycle/status")
    assert response.status_code == 404


async def test_get_status_returns_active_positions(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    target = await make_user(email="lifecycle-target@school.edu")
    org = Org(name=f"學籍測試組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="幹部")
    db_session.add(position)
    await db_session.flush()
    db_session.add(
        UserPosition(
            user_id=target.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=5),
            end_date=None,
        )
    )
    await db_session.flush()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get(f"/admin/users/{target.id}/lifecycle/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_active"] is True
    assert len(payload["active_positions"]) == 1


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/lifecycle/freeze
# ---------------------------------------------------------------------------


async def test_freeze_user_ends_active_positions_and_deactivates(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    target = await make_user(email="freeze-target@school.edu")
    org = Org(name=f"凍結測試組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="幹部")
    db_session.add(position)
    await db_session.flush()
    user_position = UserPosition(
        user_id=target.id,
        position_id=position.id,
        start_date=local_today() - timedelta(days=5),
        end_date=None,
    )
    db_session.add(user_position)
    await db_session.flush()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/admin/users/{target.id}/lifecycle/freeze", json={"reason": "離校"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["action"] == "freeze"
    assert payload["affected_positions"] == 1
    assert payload["was_active"] is True

    await db_session.refresh(target)
    await db_session.refresh(user_position)
    assert target.is_active is False
    assert user_position.end_date == local_today()


async def test_freeze_nonexistent_user_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/admin/users/{uuid.uuid4()}/lifecycle/freeze", json={})
    assert response.status_code == 404


async def test_freeze_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., object],
) -> None:
    target = await make_user(email="freeze-target2@school.edu")
    ac = _authed(authed_client_factory, member_user)

    response = await ac.post(f"/admin/users/{target.id}/lifecycle/freeze", json={})

    assert response.status_code == 403


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/lifecycle/archive-alumni
# ---------------------------------------------------------------------------


async def test_archive_alumni_appends_suffix_to_display_name(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    target = await make_user(email="alumni-target@school.edu", display_name="畢業生甲")

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(
        f"/admin/users/{target.id}/lifecycle/archive-alumni", json={"reason": "畢業"}
    )

    assert response.status_code == 200
    assert response.json()["action"] == "archive_alumni"

    await db_session.refresh(target)
    assert target.display_name == "畢業生甲（校友）"
    assert target.is_active is False


async def test_archive_alumni_does_not_double_append_suffix(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    target = await make_user(email="alumni-target2@school.edu", display_name="畢業生乙（校友）")

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/admin/users/{target.id}/lifecycle/archive-alumni", json={})

    assert response.status_code == 200
    await db_session.refresh(target)
    assert target.display_name == "畢業生乙（校友）"


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/lifecycle/restore
# ---------------------------------------------------------------------------


async def test_restore_reactivates_and_strips_alumni_suffix(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    target = await make_user(
        email="restore-target@school.edu",
        display_name="校友丙（校友）",
        is_active=False,
    )

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/admin/users/{target.id}/lifecycle/restore", json={"reason": "回任"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["action"] == "restore"
    assert payload["was_active"] is False

    await db_session.refresh(target)
    assert target.is_active is True
    assert target.display_name == "校友丙"


async def test_restore_nonexistent_user_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/admin/users/{uuid.uuid4()}/lifecycle/restore", json={})
    assert response.status_code == 404


async def test_restore_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., object],
) -> None:
    target = await make_user(email="restore-target2@school.edu", is_active=False)
    ac = _authed(authed_client_factory, member_user)

    response = await ac.post(f"/admin/users/{target.id}/lifecycle/restore", json={})

    assert response.status_code == 403
