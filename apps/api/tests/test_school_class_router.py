"""班級系統路由測試（apps/api/src/api/routers/school_class.py）。

service 層邏輯已由 test_shop_class.py 涵蓋（class_svc 直接呼叫）；本檔補齊 HTTP
層：router 權限檢查、404/409/422 分支。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import cache as cache_svc
from api.models.person import Person
from api.models.school_class import SchoolClass
from api.models.user import User
from api.routers import school_class as class_router
from api.schemas.school_class import ClassStudentRangeCreate, SchoolClassCreate
from api.services import school_class as class_svc


async def _make_class(
    db: AsyncSession,
    creator: User,
    *,
    academic_year: int = 115,
    start: str = "11501",
    end: str = "11540",
) -> SchoolClass:
    return await class_svc.create_class(
        db,
        data=SchoolClassCreate(
            academic_year=academic_year,
            class_code=f"c{uuid.uuid4().hex[:4]}",
            grade=1,
            ranges=[ClassStudentRangeCreate(student_id_start=start, student_id_end=end)],
        ),
        created_by=creator.id,
    )


async def test_list_classes_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/classes")
    assert response.status_code == 403


async def test_import_roster_file_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.post(
        "/classes/roster/import",
        files={"file": ("roster.csv", b"display_name,class_code,seat_number,student_id\n")},
        data={"academic_year": "115"},
    )
    assert response.status_code == 403


async def test_import_roster_file_creates_records(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/classes/roster/import",
        files={
            "file": (
                "115-1-roster-import.csv",
                ("display_name,class_code,seat_number,student_id\n王○勛,101,1,510001\n").encode(),
                "text/csv",
            )
        },
    )

    assert response.status_code == 200
    assert response.json()["class_codes"] == ["101"]
    assert response.json()["roster_created"] == 1


async def test_create_class_and_get_detail(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/classes",
        json={"academic_year": 115, "class_code": "101", "grade": 1, "label": "一年一班"},
    )
    assert response.status_code == 201
    class_id = response.json()["id"]

    detail = await ac.get(f"/classes/{class_id}")
    assert detail.status_code == 200
    assert detail.json()["label"] == "一年一班"


async def test_create_class_duplicate_code_conflicts(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    payload = {"academic_year": 115, "class_code": "202", "grade": 2}
    first = await ac.post("/classes", json=payload)
    assert first.status_code == 201
    second = await ac.post("/classes", json=payload)
    assert second.status_code == 409


async def test_get_class_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/classes/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_update_class_changes_label(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    sc = await _make_class(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.patch(f"/classes/{sc.id}", json={"label": "改名班級"})
    assert response.status_code == 200
    assert response.json()["label"] == "改名班級"


async def test_delete_class_removes_it(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    sc = await _make_class(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.delete(f"/classes/{sc.id}")
    assert response.status_code == 204
    get_resp = await ac.get(f"/classes/{sc.id}")
    assert get_resp.status_code == 404


async def test_get_my_class_resolves_by_student_id(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user, start="20001", end="20040")
    student = await make_user(email="my-class-student@school.edu", student_id="20010")
    ac = authed_client_factory(student)
    response = await ac.get("/classes/me")
    assert response.status_code == 200
    assert response.json()["id"] == str(sc.id)


async def test_list_members_derives_from_ranges(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user, start="30001", end="30040")
    await make_user(email="member-in-range@school.edu", student_id="30005")
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/classes/{sc.id}/members")
    assert response.status_code == 200
    student_ids = {row["student_id"] for row in response.json()}
    assert "30005" in student_ids


async def test_class_representative_can_read_own_members_but_not_other_classes(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    school_class = await _make_class(db_session, admin_user, start="31001", end="31020")
    other_class = await _make_class(
        db_session,
        admin_user,
        academic_year=116,
        start="41001",
        end="41020",
    )
    representative = await make_user(
        email="class-representative-members@school.edu",
        student_id="31005",
    )
    classmate = await make_user(
        email="class-member-no-roster-access@school.edu", student_id="31006"
    )
    admin_client = authed_client_factory(admin_user)
    assignment = await admin_client.post(
        f"/classes/{school_class.id}/roles/class_representative/assign",
        json={"user_id": str(representative.id)},
    )
    assert assignment.status_code == 201

    representative_client = authed_client_factory(representative)
    own_roster = await representative_client.get(f"/classes/{school_class.id}/members")
    other_roster = await representative_client.get(f"/classes/{other_class.id}/members")
    classmate_roster = await authed_client_factory(classmate).get(
        f"/classes/{school_class.id}/members"
    )

    assert own_roster.status_code == 200
    assert "31005" in {row["student_id"] for row in own_roster.json()}
    assert other_roster.status_code == 403
    assert classmate_roster.status_code == 403


async def test_add_and_end_membership(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    other = await make_user(email="membership-target@school.edu")
    ac = authed_client_factory(admin_user)
    add_resp = await ac.post(f"/classes/{sc.id}/memberships", json={"user_id": str(other.id)})
    assert add_resp.status_code == 201

    list_resp = await ac.get(f"/classes/{sc.id}/memberships")
    assert list_resp.status_code == 200
    assert any(row["user_id"] == str(other.id) for row in list_resp.json())

    end_resp = await ac.delete(f"/classes/{sc.id}/memberships/{other.id}")
    assert end_resp.status_code == 204

    end_again_resp = await ac.delete(f"/classes/{sc.id}/memberships/{other.id}")
    assert end_again_resp.status_code == 404


async def test_list_class_roles_includes_default_bindings(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    sc = await _make_class(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/classes/{sc.id}/roles")
    assert response.status_code == 200
    roles = response.json()
    role_keys = {row["role_key"] for row in roles}
    assert "class_leader" in role_keys
    assert role_keys.isdisjoint({"lunch_manager", "treasurer", "discipline", "general_affairs"})
    leader = next(row for row in roles if row["role_key"] == "class_leader")
    vice_leader = next(row for row in roles if row["role_key"] == "vice_leader")
    representative = next(row for row in roles if row["role_key"] == "class_representative")
    assert "class:shop_collect" not in leader["permission_codes"]
    assert "class:shop_collect" not in vice_leader["permission_codes"]
    assert "class:shop_collect" in representative["permission_codes"]


async def test_assign_class_role_returns_position(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    student = await make_user(email="class-leader-candidate@school.edu")
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        f"/classes/{sc.id}/roles/class_leader/assign", json={"user_id": str(student.id)}
    )
    assert response.status_code == 201
    body = response.json()
    assert "user_position_id" in body
    assert "position_id" in body


async def test_assign_class_representative_refreshes_cached_permissions(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sc = await _make_class(db_session, admin_user)
    representative = await make_user(email="class-representative-cache@school.edu")
    permission_cache: dict[str, list[str]] = {}
    invalidated_user_ids: list[str] = []

    async def fake_cache_get(key: str) -> list[str] | None:
        return permission_cache.get(key)

    async def fake_cache_set(key: str, value: list[str], ttl: int = 60) -> None:
        permission_cache[key] = value

    async def record_permission_invalidation(user_id: str) -> None:
        invalidated_user_ids.append(user_id)
        permission_cache.pop(f"perm:{user_id}", None)

    monkeypatch.setattr(cache_svc, "cache_get", fake_cache_get)
    monkeypatch.setattr(cache_svc, "cache_set", fake_cache_set)
    monkeypatch.setattr(
        class_router, "cache_invalidate_user_permissions", record_permission_invalidation
    )

    representative_client = authed_client_factory(representative)
    initial_auth = await representative_client.get("/auth/me")
    assert initial_auth.status_code == 200
    assert "class:shop_collect" not in initial_auth.json()["permissions"]

    assigned = await authed_client_factory(admin_user).post(
        f"/classes/{sc.id}/roles/class_representative/assign",
        json={"user_id": str(representative.id)},
    )
    assert assigned.status_code == 201
    assert invalidated_user_ids == [str(representative.id)]

    refreshed_auth = await representative_client.get("/auth/me")
    assert refreshed_auth.status_code == 200
    assert "class:shop_collect" in refreshed_auth.json()["permissions"]


async def test_assign_class_role_to_unregistered_roster_member_is_pending_until_signup(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    roster = await ac.post(
        f"/classes/{sc.id}/roster",
        json={"seat_number": 8, "student_id": "510008"},
    )
    assert roster.status_code == 201

    assignment = await ac.post(
        f"/classes/{sc.id}/roles/class_leader/assign-person",
        json={"student_id": "510008", "display_name": "待註冊同學"},
    )
    assert assignment.status_code == 201
    body = assignment.json()
    assert body["status"] == "pending_user"
    assert body["person_id"]

    members = await ac.get(f"/classes/{sc.id}/members")
    assert any(
        row["id"] == body["person_id"] and row["display_name"] == "待註冊同學"
        for row in members.json()
    )
    roles = await ac.get(f"/classes/{sc.id}/roles")
    leader = next(row for row in roles.json() if row["role_key"] == "class_leader")
    assert leader["holders"] == []
    assert len(leader["person_holders"]) == 1
    holder = leader["person_holders"][0]
    assert holder["affiliation_id"] == body["person_affiliation_id"]
    assert holder["person_id"] == body["person_id"]
    assert holder["display_name"] == "待註冊同學"
    assert holder["student_id"] == "510008"
    assert holder["status"] == "pending_user"


async def test_assign_class_person_role_requires_class_manager(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    admin = authed_client_factory(admin_user)
    roster = await admin.post(
        f"/classes/{sc.id}/roster",
        json={"seat_number": 8, "student_id": "510008"},
    )
    assert roster.status_code == 201

    response = await authed_client_factory(member_user).post(
        f"/classes/{sc.id}/roles/class_leader/assign-person",
        json={"student_id": "510008", "display_name": "待註冊同學"},
    )
    assert response.status_code == 403


async def test_assign_class_person_role_rejects_people_outside_the_class(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    person = Person(display_name="其他班同學", student_id="510100")
    db_session.add(person)
    await db_session.flush()

    response = await authed_client_factory(admin_user).post(
        f"/classes/{sc.id}/roles/class_leader/assign-person",
        json={"person_id": str(person.id)},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "此人員不是本班成員"


async def test_assign_class_role_unknown_or_removed_role_key_returns_422(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    student = await make_user(email="unknown-role-candidate@school.edu")
    ac = authed_client_factory(admin_user)
    for role_key in (
        "not_a_real_role",
        "lunch_manager",
        "treasurer",
        "discipline",
        "general_affairs",
    ):
        response = await ac.post(
            f"/classes/{sc.id}/roles/{role_key}/assign", json={"user_id": str(student.id)}
        )
        assert response.status_code == 422


async def test_add_and_delete_range(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    sc = await _make_class(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    add_resp = await ac.post(
        f"/classes/{sc.id}/ranges",
        json={"student_id_start": "40001", "student_id_end": "40040"},
    )
    assert add_resp.status_code == 201
    range_id = add_resp.json()["id"]

    delete_resp = await ac.delete(f"/classes/{sc.id}/ranges/{range_id}")
    assert delete_resp.status_code == 204

    delete_again_resp = await ac.delete(f"/classes/{sc.id}/ranges/{range_id}")
    assert delete_again_resp.status_code == 404


async def test_roster_routes_support_single_bulk_update_and_delete(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    ac = authed_client_factory(admin_user)

    add_resp = await ac.post(
        f"/classes/{sc.id}/roster",
        json={"seat_number": 1, "student_id": "91501"},
    )
    assert add_resp.status_code == 201
    entry_id = add_resp.json()["id"]
    assert add_resp.json()["user_id"] is None

    bulk_resp = await ac.post(
        f"/classes/{sc.id}/roster/bulk",
        json={
            "entries": [
                {"seat_number": 1, "student_id": "91511"},
                {"seat_number": 2, "student_id": "91512"},
            ]
        },
    )
    assert bulk_resp.status_code == 200
    assert (bulk_resp.json()["created"], bulk_resp.json()["updated"]) == (1, 1)

    update_resp = await ac.patch(
        f"/classes/{sc.id}/roster/{entry_id}",
        json={"seat_number": 3, "student_id": "91513"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["seat_number"] == 3

    list_resp = await ac.get(f"/classes/{sc.id}/roster")
    assert list_resp.status_code == 200
    assert [(row["seat_number"], row["student_id"]) for row in list_resp.json()] == [
        (2, "91512"),
        (3, "91513"),
    ]

    delete_resp = await ac.delete(f"/classes/{sc.id}/roster/{entry_id}")
    assert delete_resp.status_code == 204


async def test_add_manual_member_then_remove(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    other = await make_user(email="manual-member@school.edu")
    ac = authed_client_factory(admin_user)
    add_resp = await ac.post(f"/classes/{sc.id}/members", json={"user_id": str(other.id)})
    assert add_resp.status_code == 201

    list_resp = await ac.get(f"/classes/{sc.id}/manual-members")
    assert list_resp.status_code == 200
    assert any(row["user_id"] == str(other.id) for row in list_resp.json())

    remove_resp = await ac.delete(f"/classes/{sc.id}/members/{other.id}")
    assert remove_resp.status_code == 204

    remove_again_resp = await ac.delete(f"/classes/{sc.id}/members/{other.id}")
    assert remove_again_resp.status_code == 404


async def test_add_manual_member_duplicate_conflicts(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    other = await make_user(email="manual-dup@school.edu")
    ac = authed_client_factory(admin_user)
    await ac.post(f"/classes/{sc.id}/members", json={"user_id": str(other.id)})
    dup_resp = await ac.post(f"/classes/{sc.id}/members", json={"user_id": str(other.id)})
    assert dup_resp.status_code == 409


async def test_add_and_remove_cadre(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user, start="50001", end="50040")
    cadre_user = await make_user(email="cadre-user@school.edu", student_id="50003")
    ac = authed_client_factory(admin_user)
    add_resp = await ac.post(f"/classes/{sc.id}/cadres", json={"user_id": str(cadre_user.id)})
    assert add_resp.status_code == 201

    remove_resp = await ac.delete(f"/classes/{sc.id}/cadres/{cadre_user.id}")
    assert remove_resp.status_code == 204

    remove_again_resp = await ac.delete(f"/classes/{sc.id}/cadres/{cadre_user.id}")
    assert remove_again_resp.status_code == 404


async def test_add_cadre_requires_class_member(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user, start="60001", end="60040")
    not_a_member = await make_user(email="not-in-class@school.edu", student_id="99999")
    ac = authed_client_factory(admin_user)
    response = await ac.post(f"/classes/{sc.id}/cadres", json={"user_id": str(not_a_member.id)})
    assert response.status_code == 409


async def test_bulk_create_classes(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/classes/bulk",
        json={
            "academic_year": 115,
            "grades": [{"grade": 3, "class_start": 1, "class_end": 2, "range_template": None}],
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["total"] == 2
    assert body["succeeded"] == 2


async def test_bulk_action_classes_deactivate(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    sc = await _make_class(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/classes/bulk/action", json={"class_ids": [str(sc.id)], "action": "deactivate"}
    )
    assert response.status_code == 200
    assert response.json()["succeeded"] == 1

    detail = await ac.get(f"/classes/{sc.id}")
    assert detail.json()["is_active"] is False
