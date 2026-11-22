"""人員主檔與身分歸屬路由測試（apps/api/src/api/routers/people.py）。"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.permission_codes import PermissionCode
from api.models.org import Org, Permission, Position, UserPosition
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
    PersonStatus,
)
from api.models.school_class import ClassRosterEntry, SchoolClass
from api.models.user import User
from api.services import person as person_svc


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


async def _make_people_manager(
    db_session: AsyncSession, permission_code: PermissionCode
) -> tuple[User, Org]:
    user = User(
        email=f"manager-{uuid.uuid4().hex[:8]}@school.edu",
        display_name="範圍管理者",
        is_active=True,
        is_verified=True,
    )
    org = Org(name=f"範圍組織-{uuid.uuid4().hex[:6]}")
    db_session.add_all([user, org])
    await db_session.flush()
    position = Position(org_id=org.id, name="範圍管理職位")
    db_session.add(position)
    await db_session.flush()
    db_session.add_all(
        [
            Permission(position_id=position.id, code=permission_code.value),
            UserPosition(user_id=user.id, position_id=position.id, start_date=local_today()),
        ]
    )
    await db_session.flush()
    return user, org


async def _add_org_affiliation(
    db_session: AsyncSession, person: Person, org: Org
) -> PersonAffiliation:
    affiliation = PersonAffiliation(
        person_id=person.id,
        kind=PersonAffiliationKind.ORG_POSITION,
        org_id=org.id,
        title="組織成員",
        start_date=local_today(),
        status=PersonAffiliationStatus.ACTIVE,
        source=PersonAffiliationSource.MANUAL,
    )
    db_session.add(affiliation)
    await db_session.flush()
    return affiliation


async def test_org_member_manager_only_sees_people_in_managed_org(
    authed_client_factory: Callable[[User], AsyncClient],
    db_session: AsyncSession,
) -> None:
    manager, managed_org = await _make_people_manager(db_session, PermissionCode.ORG_MANAGE_MEMBERS)
    outside_org = Org(name=f"外部組織-{uuid.uuid4().hex[:6]}")
    db_session.add(outside_org)
    await db_session.flush()

    visible = await _make_person(
        db_session,
        student_id=f"S{uuid.uuid4().hex[:8]}",
        display_name="範圍內人員",
        legal_name="範圍內本名",
        email="inside@example.edu",
    )
    hidden = await _make_person(
        db_session,
        student_id=f"S{uuid.uuid4().hex[:8]}",
        display_name="範圍外人員",
        legal_name="範圍外本名",
        email="outside@example.edu",
    )
    managed_class = SchoolClass(
        academic_year=115,
        class_code="103",
        label="組織範圍班級",
        created_by=manager.id,
        org_id=managed_org.id,
    )
    db_session.add(managed_class)
    await db_session.flush()
    await _add_org_affiliation(db_session, visible, managed_org)
    await _add_org_affiliation(db_session, visible, outside_org)
    await _add_org_affiliation(db_session, hidden, outside_org)
    db_session.add(
        PersonAffiliation(
            person_id=visible.id,
            kind=PersonAffiliationKind.CLASS_MEMBER,
            class_id=managed_class.id,
            org_id=managed_org.id,
            start_date=local_today(),
            status=PersonAffiliationStatus.ACTIVE,
            source=PersonAffiliationSource.MANUAL,
        )
    )
    await db_session.flush()

    client = authed_client_factory(manager)
    scope = await client.get("/people/access-scope")
    assert scope.status_code == 200
    assert scope.json()["is_global"] is False
    assert scope.json()["org_ids"] == [str(managed_org.id)]
    assert scope.json()["class_ids"] == [str(managed_class.id)]

    response = await client.get("/people")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(visible.id)]
    assert "範圍外本名" not in response.text

    stats = await client.get("/people/stats")
    assert stats.status_code == 200
    assert stats.json()["people_count"] == 1
    assert stats.json()["matched_people_count"] == 1

    detail = await client.get(f"/people/{visible.id}")
    assert detail.status_code == 200
    assert {item["org_id"] for item in detail.json()["affiliations"]} == {str(managed_org.id)}
    assert (await client.get(f"/people/{hidden.id}")).status_code == 404
    assert (
        await client.patch(f"/people/{visible.id}", json={"legal_name": "不應可改"})
    ).status_code == 403
    assert (await client.post("/people", json={"display_name": "未歸屬人員"})).status_code == 403
    assert (
        await client.post(
            "/people/affiliations",
            json={
                "person_id": str(visible.id),
                "kind": "class_member",
                "class_id": str(managed_class.id),
            },
        )
    ).status_code == 404


async def test_class_manager_import_is_limited_to_managed_class_and_preserves_shared_person_data(
    authed_client_factory: Callable[[User], AsyncClient],
    db_session: AsyncSession,
) -> None:
    manager, managed_org = await _make_people_manager(db_session, PermissionCode.CLASS_MANAGE)
    outside_org = Org(name=f"其他班級組織-{uuid.uuid4().hex[:6]}")
    db_session.add(outside_org)
    await db_session.flush()
    managed_class = SchoolClass(
        academic_year=115,
        class_code="101",
        label="管理範圍班級",
        created_by=manager.id,
        org_id=managed_org.id,
    )
    outside_class = SchoolClass(
        academic_year=115,
        class_code="102",
        label="其他班級",
        created_by=manager.id,
        org_id=outside_org.id,
    )
    db_session.add_all([managed_class, outside_class])
    await db_session.flush()

    org_member = await _make_person(
        db_session,
        student_id="SCOPE115ORG",
        display_name="只屬於組織的成員",
        legal_name="不應顯示本名",
        email="org-only@example.edu",
    )
    await _add_org_affiliation(db_session, org_member, managed_org)
    existing = await _make_person(
        db_session,
        student_id="SCOPE11501",
        display_name="既有姓名",
        email="old@example.edu",
        note="既有備註",
    )
    db_session.add(
        PersonAffiliation(
            person_id=existing.id,
            kind=PersonAffiliationKind.CLASS_MEMBER,
            class_id=managed_class.id,
            org_id=managed_org.id,
            start_date=local_today(),
            status=PersonAffiliationStatus.ACTIVE,
            source=PersonAffiliationSource.MANUAL,
        )
    )
    await db_session.flush()
    client = authed_client_factory(manager)
    scope = await client.get("/people/access-scope")
    assert scope.status_code == 200
    assert scope.json()["class_ids"] == [str(managed_class.id)]
    assert scope.json()["org_ids"] == [str(managed_org.id)]

    people = await client.get("/people")
    assert people.status_code == 200
    assert [item["id"] for item in people.json()] == [str(existing.id)]
    assert "不應顯示本名" not in people.text
    assert (await client.get(f"/people/{org_member.id}")).status_code == 404

    outside_import = await client.post(
        "/people/import-roster",
        json={
            "rows": [
                {
                    "student_id": "SCOPE11502",
                    "display_name": "外班學生",
                    "class_id": str(outside_class.id),
                }
            ]
        },
    )
    assert outside_import.status_code == 403

    scoped_import = await client.post(
        "/people/import-roster",
        json={
            "rows": [
                {
                    "student_id": "SCOPE11501",
                    "display_name": "匯入檔新姓名",
                    "email": "new@example.edu",
                    "note": "匯入檔備註",
                    "class_id": str(managed_class.id),
                },
                {
                    "student_id": "SCOPE11503",
                    "display_name": "新班級學生",
                    "class_id": str(managed_class.id),
                },
            ]
        },
    )
    assert scoped_import.status_code == 200
    assert scoped_import.json()["people_created"] == 1
    assert scoped_import.json()["people_updated"] == 0
    await db_session.refresh(existing)
    assert existing.display_name == "既有姓名"
    assert existing.email == "old@example.edu"
    assert existing.note == "既有備註"


async def test_list_people_requires_login(client: AsyncClient) -> None:
    response = await client.get("/people")
    assert response.status_code == 401


async def test_list_people_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/people")
    assert response.status_code == 403


async def test_people_access_scope_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    response = await authed_client_factory(member_user).get("/people/access-scope")
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


async def test_list_people_marks_non_current_g0_accounts_as_alumni(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
) -> None:
    alumnus = await make_user(
        email="g0110001@hchs.hc.edu.tw", student_id="110001", display_name="舊屆學生"
    )
    current_student = await make_user(
        email="g0510001@hchs.hc.edu.tw", student_id="510001", display_name="在校學生"
    )
    teacher = await make_user(email="teacher@hchs.hc.edu.tw", display_name="校內師長")

    response = await authed_client_factory(admin_user).get("/people")

    assert response.status_code == 200
    people_by_user_id = {row["user_id"]: row for row in response.json()}
    assert people_by_user_id[str(alumnus.id)]["status"] == PersonStatus.ALUMNI
    assert people_by_user_id[str(current_student.id)]["status"] == PersonStatus.ACTIVE
    assert people_by_user_id[str(teacher.id)]["status"] == PersonStatus.ACTIVE


async def test_ensure_person_for_user_marks_non_current_g0_account_as_alumni(
    db_session: AsyncSession,
    make_user: Callable[..., User],
) -> None:
    alumnus = await make_user(
        email="g0210001@hchs.hc.edu.tw", student_id="210001", display_name="另一屆校友"
    )

    person = await person_svc.ensure_person_for_user(db_session, alumnus)

    assert person.status == PersonStatus.ALUMNI


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


async def test_get_person_includes_class_roster_seat(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    user = User(
        email="roster-student@example.com",
        display_name="名冊學生",
        student_id="SROSTER001",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    person = await _make_person(
        db_session,
        student_id=user.student_id,
        display_name=user.display_name,
        user_id=user.id,
    )
    school_class = SchoolClass(
        academic_year=115,
        class_code="101",
        label="115 高一 01 班",
        created_by=admin_user.id,
    )
    db_session.add(school_class)
    await db_session.flush()
    db_session.add(
        ClassRosterEntry(
            class_id=school_class.id,
            seat_number=12,
            student_id=user.student_id,
            user_id=user.id,
        )
    )
    await db_session.flush()

    response = await authed_client_factory(admin_user).get(f"/people/{person.id}")

    assert response.status_code == 200
    assert response.json()["class_roster"] == [
        {
            "class_id": str(school_class.id),
            "academic_year": 115,
            "class_code": "101",
            "class_label": "115 高一 01 班",
            "is_active": True,
            "seat_number": 12,
            "student_id": "SROSTER001",
        }
    ]


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


async def test_end_future_org_affiliation_keeps_a_valid_date_range(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    person = await _make_person(db_session, user_id=admin_user.id)
    org = Org(name=f"未開始任期組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="未開始職位")
    db_session.add(position)
    await db_session.flush()

    start_date = date.today() + timedelta(days=7)
    user_position = UserPosition(
        user_id=admin_user.id,
        position_id=position.id,
        start_date=start_date,
        end_date=start_date + timedelta(days=365),
    )
    db_session.add(user_position)
    await db_session.flush()
    affiliation = PersonAffiliation(
        person_id=person.id,
        kind=PersonAffiliationKind.ORG_POSITION,
        org_id=org.id,
        position_id=position.id,
        title=position.name,
        start_date=start_date,
        end_date=user_position.end_date,
        status=PersonAffiliationStatus.ACTIVE,
        source=PersonAffiliationSource.RBAC_SYNC,
        synced_user_position_id=user_position.id,
    )
    db_session.add(affiliation)
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.delete(f"/people/affiliations/{affiliation.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ended"
    assert body["end_date"] == start_date.isoformat()


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
