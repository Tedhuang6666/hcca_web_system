"""Admin RBAC management routes."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.main import app
from api.dependencies.auth import get_current_active_user
from api.models.org import Org, Position, UserPosition
from api.models.user import User


async def _seed_admin_data(db: AsyncSession) -> tuple[User, User, Org, Position, UserPosition]:
    admin = User(
        email="admin@school.edu",
        display_name="管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    member = User(
        email="member@school.edu",
        display_name="幹部",
        is_active=True,
        is_verified=True,
    )
    org = Org(name="學生代表大會")
    db.add_all([admin, member, org])
    await db.flush()

    position = Position(org_id=org.id, name="議長", weight=10)
    db.add(position)
    await db.flush()

    assignment = UserPosition(
        user_id=member.id,
        position_id=position.id,
        start_date=date.today(),
        end_date=None,
    )
    db.add(assignment)
    await db.flush()
    return admin, member, org, position, assignment


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


@pytest.mark.asyncio
async def test_admin_can_update_position_weight(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, _, _, position, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.patch(f"/admin/positions/{position.id}", json={"weight": 42})

    assert response.status_code == 200
    assert response.json()["weight"] == 42


@pytest.mark.asyncio
async def test_admin_can_update_user_position_dates(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, assignment = await _seed_admin_data(db_session)
    _override_user(admin)
    start = date.today() - timedelta(days=7)
    end = date.today() + timedelta(days=30)

    response = await client.patch(
        f"/admin/users/{member.id}/positions/{assignment.id}",
        json={"start_date": start.isoformat(), "end_date": end.isoformat()},
    )

    assert response.status_code == 200
    updated = response.json()["positions"][0]
    assert updated["user_position_id"] == str(assignment.id)


@pytest.mark.asyncio
async def test_admin_route_without_admin_permission_returns_403(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, member, _, position, _ = await _seed_admin_data(db_session)
    _override_user(member)

    response = await client.patch(f"/admin/positions/{position.id}", json={"weight": 20})

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_update_missing_user_position_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.patch(
        f"/admin/users/{member.id}/positions/00000000-0000-0000-0000-000000000000",
        json={"start_date": date.today().isoformat()},
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_admin_can_pre_register_external_email_with_login_permission(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, _, org, position, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.post(
        "/admin/users/pre-register",
        json={
            "display_name": "外部顧問",
            "email": "advisor@gmail.com",
            "allow_external_login": True,
            "position_ids": [str(position.id)],
            "custom_permission_org_id": str(org.id),
            "custom_permission_codes": [],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["email"] == "advisor@gmail.com"
    assert payload["allow_external_login"] is True
    assert payload["positions"][0]["id"] == str(position.id)


@pytest.mark.asyncio
async def test_admin_can_toggle_external_login_permission(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.patch(
        f"/admin/users/{member.id}",
        json={"allow_external_login": True},
    )

    assert response.status_code == 200
    assert response.json()["allow_external_login"] is True
