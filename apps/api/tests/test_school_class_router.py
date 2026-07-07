"""班級系統路由測試（apps/api/src/api/routers/school_class.py）。

service 層邏輯已由 test_shop_class.py 涵蓋（class_svc 直接呼叫）；本檔補齊 HTTP
層：router 權限檢查、404/409/422 分支。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.school_class import SchoolClass
from api.models.user import User
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
    role_keys = {row["role_key"] for row in response.json()}
    assert "class_leader" in role_keys


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


async def test_assign_class_role_unknown_role_key_returns_422(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, admin_user)
    student = await make_user(email="unknown-role-candidate@school.edu")
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        f"/classes/{sc.id}/roles/not_a_real_role/assign", json={"user_id": str(student.id)}
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
