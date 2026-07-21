"""Admin RBAC management routes."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.org import Org, Position, UserPosition
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.routers import auth as auth_router


async def _seed_admin_data(db: AsyncSession) -> tuple[User, User, Org, Position, UserPosition]:
    admin = User(
        email="admin@school.edu",
        display_name="管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
        mfa_enabled=True,
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
            "position_ids": [str(position.id)],
            "custom_permission_org_id": str(org.id),
            "custom_permission_codes": [],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["email"] == "advisor@gmail.com"
    assert payload["positions"][0]["id"] == str(position.id)


@pytest.mark.asyncio
async def test_pre_register_school_email_extracts_student_id_and_links_aliases(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, _, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.post(
        "/admin/users/pre-register",
        json={
            "display_name": "多信箱學生",
            "email": "g0112040103@hchs.hc.edu.tw",
            "linked_emails": ["student.private@gmail.com"],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["student_id"] == "112040103"
    assert payload["linked_emails"] == [
        "g0112040103@hchs.hc.edu.tw",
        "student.private@gmail.com",
    ]


@pytest.mark.asyncio
async def test_google_login_with_linked_email_uses_existing_user(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = User(
        email="g0112040104@hchs.hc.edu.tw",
        display_name="別名登入學生",
        student_id="112040104",
        is_active=True,
        is_verified=False,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        UserIdentity(
            user_id=user.id,
            provider="email",
            external_id="linked.private@gmail.com",
            email="linked.private@gmail.com",
            display_name=user.display_name,
            linked_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    async def not_suspicious(*_args: object) -> tuple[bool, None]:
        return False, None

    async def no_op(*_args: object) -> None:
        return None

    monkeypatch.setattr(auth_router, "check_suspicious_login", not_suspicious)
    monkeypatch.setattr(auth_router, "record_login", no_op)

    logged_in = await auth_router._upsert_google_user(
        db_session,
        google_sub="google-linked-sub",
        email="linked.private@gmail.com",
        display_name="別名登入學生",
        avatar_url=None,
        client_ip="127.0.0.1",
        user_agent="pytest",
    )

    assert logged_in.id == user.id
    assert (
        await db_session.scalar(select(User).where(User.email == "linked.private@gmail.com"))
        is None
    )
    identity = await db_session.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "google",
            UserIdentity.external_id == "google-linked-sub",
        )
    )
    assert identity is not None
    assert identity.user_id == user.id


@pytest.mark.asyncio
async def test_admin_can_link_school_email_to_existing_user_and_extract_student_id(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.post(
        f"/admin/users/{member.id}/emails",
        json={"emails": ["g0112040105@hchs.hc.edu.tw", "member.private@gmail.com"]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["student_id"] == "112040105"
    assert set(payload["linked_emails"]) == {
        "g0112040105@hchs.hc.edu.tw",
        "member@school.edu",
        "member.private@gmail.com",
    }


@pytest.mark.asyncio
async def test_admin_can_merge_previously_logged_in_secondary_account(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    secondary = User(
        email="secondary.private@gmail.com",
        display_name="次要帳號",
        google_sub="secondary-google-sub",
        is_active=True,
        is_verified=True,
    )
    secondary_email = secondary.email
    db_session.add(secondary)
    await db_session.flush()
    db_session.add(
        UserIdentity(
            user_id=secondary.id,
            provider="google",
            external_id=secondary.google_sub,
            email=secondary.email,
            display_name=secondary.display_name,
            linked_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    _override_user(admin)

    response = await client.post(
        f"/admin/users/{member.id}/emails",
        json={"emails": [secondary.email]},
    )

    assert response.status_code == 200
    assert secondary_email in response.json()["linked_emails"]
    await db_session.refresh(secondary)
    assert secondary.is_active is False
    assert secondary.email.endswith("@deleted.local")
    identity = await db_session.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "google",
            UserIdentity.external_id == "secondary-google-sub",
        )
    )
    assert identity is not None
    assert identity.user_id == member.id

    async def not_suspicious(*_args: object) -> tuple[bool, None]:
        return False, None

    async def no_op(*_args: object) -> None:
        return None

    monkeypatch.setattr(auth_router, "check_suspicious_login", not_suspicious)
    monkeypatch.setattr(auth_router, "record_login", no_op)
    logged_in = await auth_router._upsert_google_user(
        db_session,
        google_sub="secondary-google-sub",
        email=secondary_email,
        display_name="次要帳號",
        avatar_url=None,
        client_ip="127.0.0.1",
        user_agent="pytest",
    )
    assert logged_in.id == member.id


@pytest.mark.asyncio
async def test_admin_can_batch_pre_register_with_partial_failure(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, position, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.post(
        "/admin/users/pre-register/batch",
        json={
            "users": [
                {
                    "display_name": "批次學生",
                    "student_id": "112040101",
                    "position_ids": [str(position.id)],
                },
                {
                    "display_name": "重複帳號",
                    "email": member.email,
                    "position_ids": [str(position.id)],
                },
            ]
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["created"] == 1
    assert payload["failed"] == 1
    assert payload["results"][0]["email"] == "g0112040101@hchs.hc.edu.tw"
    assert payload["results"][1]["error"] == "學號或 Email 已存在"
