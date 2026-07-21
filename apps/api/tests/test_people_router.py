"""人員主檔與身分歸屬路由測試（apps/api/src/api/routers/people.py）。"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.person import Person
from api.models.user import User


async def _make_person(db_session: AsyncSession, **overrides) -> Person:
    defaults = dict(
        student_id=f"S{uuid.uuid4().hex[:8]}",
        display_name="測試學生",
    )
    defaults.update(overrides)
    person = Person(**defaults)
    db_session.add(person)
    await db_session.flush()
    return person


async def test_list_people_requires_login(client: AsyncClient) -> None:
    response = await client.get("/people")
    assert response.status_code == 401


async def test_list_people_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/people")
    assert response.status_code == 403


async def test_create_person_and_list(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post("/people", json={"student_id": "S00012345", "display_name": "王小明"})
    assert response.status_code == 201
    person_id = response.json()["id"]

    list_resp = await ac.get("/people", params={"keyword": "王小明"})
    assert list_resp.status_code == 200
    ids = {row["id"] for row in list_resp.json()}
    assert person_id in ids


async def test_list_people_includes_existing_user_without_person(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    existing_user = User(
        email="legacy-user@example.com",
        display_name="既有帳號",
        student_id="SLEGACY001",
        is_active=True,
    )
    db_session.add(existing_user)
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.get("/people")

    assert response.status_code == 200
    body = response.json()
    row = next(item for item in body if item["display_name"] == "既有帳號")
    assert row["display_name"] == "既有帳號"
    assert row["student_id"] == "SLEGACY001"
    assert row["user_id"] == str(existing_user.id)


async def test_create_person_duplicate_student_id_conflicts(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    await _make_person(db_session, student_id="S99998888", display_name="重複學號")
    ac = authed_client_factory(admin_user)
    response = await ac.post("/people", json={"student_id": "S99998888", "display_name": "另一人"})
    assert response.status_code == 409


async def test_get_person_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/people/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_get_person_returns_detail_with_affiliations(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    person = await _make_person(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/people/{person.id}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(person.id)
    assert body["affiliations"] == []


async def test_update_person_changes_display_name(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    person = await _make_person(db_session, display_name="原名")
    ac = authed_client_factory(admin_user)
    response = await ac.patch(f"/people/{person.id}", json={"display_name": "改名後"})
    assert response.status_code == 200
    assert response.json()["display_name"] == "改名後"


async def test_create_affiliation_then_end_it(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    person = await _make_person(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/people/affiliations",
        json={"person_id": str(person.id), "kind": "student"},
    )
    assert create_resp.status_code == 201
    affiliation_id = create_resp.json()["id"]
    assert create_resp.json()["status"] == "active"

    end_resp = await ac.delete(f"/people/affiliations/{affiliation_id}")
    assert end_resp.status_code == 200
    assert end_resp.json()["status"] == "ended"


async def test_create_affiliation_class_member_requires_class_id(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    person = await _make_person(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/people/affiliations",
        json={"person_id": str(person.id), "kind": "class_member"},
    )
    assert response.status_code == 422


async def test_update_affiliation_changes_title(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    person = await _make_person(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/people/affiliations",
        json={"person_id": str(person.id), "kind": "student", "title": "原title"},
    )
    affiliation_id = create_resp.json()["id"]

    update_resp = await ac.patch(
        f"/people/affiliations/{affiliation_id}", json={"title": "新title"}
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["title"] == "新title"


async def test_sync_pending_requires_admin_all(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    person = await _make_person(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.post(f"/people/{person.id}/sync-pending")
    assert response.status_code == 403


async def test_sync_pending_returns_zero_when_no_pending(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    person = await _make_person(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post(f"/people/{person.id}/sync-pending")
    assert response.status_code == 200
    assert response.json() == {"synced": 0}
