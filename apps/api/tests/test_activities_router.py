"""活動系統 HTTP 路由測試（apps/api/src/api/routers/activities.py）。

test_activity.py 已涵蓋 can_manage_activity_resource 服務層邏輯；本檔補齊 HTTP
層：CRUD、總召任命、職務/成員、跨模組關聯與工作區端點的權限與流程分支。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity
from api.models.user import User
from api.schemas.activity import ActivityCreate
from api.services import activity as activity_svc


async def _make_activity(db: AsyncSession, **overrides) -> Activity:
    defaults = dict(name=f"活動-{uuid.uuid4().hex[:6]}")
    defaults.update(overrides)
    return await activity_svc.create_activity(db, ActivityCreate(**defaults))


# ── 活動 CRUD ─────────────────────────────────────────────────────────────────


async def test_create_activity_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.post("/activities", json={"name": "新活動"})
    assert response.status_code == 403


async def test_create_activity_and_get_detail(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post("/activities", json={"name": "迎新宿營"})
    assert response.status_code == 201
    activity_id = response.json()["id"]

    detail = await ac.get(f"/activities/{activity_id}")
    assert detail.status_code == 200
    assert detail.json()["name"] == "迎新宿營"


async def test_get_activity_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/activities/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_list_activities_includes_created(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.get("/activities")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(activity.id) in ids


async def test_list_my_activities_requires_convener(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    convener = await make_user(email="convener-mine@school.edu")
    admin_ac = authed_client_factory(admin_user)
    await admin_ac.post(
        f"/activities/{activity.id}/conveners",
        json={"user_id": str(convener.id), "start_date": date.today().isoformat()},
    )

    ac = authed_client_factory(convener)
    response = await ac.get("/activities/mine")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(activity.id) in ids


async def test_update_activity_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.patch(f"/activities/{activity.id}", json={"name": "改名"})
    assert response.status_code == 403


async def test_update_activity_changes_name(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.patch(f"/activities/{activity.id}", json={"name": "新名稱"})
    assert response.status_code == 200
    assert response.json()["name"] == "新名稱"


async def test_archive_activity(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post(f"/activities/{activity.id}/archive")
    assert response.status_code == 200
    assert response.json()["status"] == "archived"


# ── 總召 ─────────────────────────────────────────────────────────────────────


async def test_appoint_convener_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    target = await make_user(email="convener-target@school.edu")
    ac = authed_client_factory(member_user)
    response = await ac.post(
        f"/activities/{activity.id}/conveners",
        json={"user_id": str(target.id), "start_date": date.today().isoformat()},
    )
    assert response.status_code == 403


async def test_appoint_list_update_remove_convener(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    target = await make_user(email="convener-lifecycle@school.edu")
    ac = authed_client_factory(admin_user)
    appoint_resp = await ac.post(
        f"/activities/{activity.id}/conveners",
        json={"user_id": str(target.id), "start_date": date.today().isoformat()},
    )
    assert appoint_resp.status_code == 201
    convener_id = appoint_resp.json()["id"]

    list_resp = await ac.get(f"/activities/{activity.id}/conveners")
    assert list_resp.status_code == 200
    assert any(row["id"] == convener_id for row in list_resp.json())

    new_end = (date.today() + timedelta(days=30)).isoformat()
    update_resp = await ac.patch(f"/activities/conveners/{convener_id}", json={"end_date": new_end})
    assert update_resp.status_code == 200
    assert update_resp.json()["end_date"] == new_end

    remove_resp = await ac.delete(f"/activities/conveners/{convener_id}")
    assert remove_resp.status_code == 204

    remove_again_resp = await ac.delete(f"/activities/conveners/{convener_id}")
    assert remove_again_resp.status_code == 404


async def test_convener_can_manage_own_activity_resources(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    convener = await make_user(email="convener-self-manage@school.edu")
    admin_ac = authed_client_factory(admin_user)
    await admin_ac.post(
        f"/activities/{activity.id}/conveners",
        json={"user_id": str(convener.id), "start_date": date.today().isoformat()},
    )

    ac = authed_client_factory(convener)
    response = await ac.post(
        f"/activities/{activity.id}/roles",
        json={"key": "staff", "name": "工作人員"},
    )
    assert response.status_code == 201


# ── 職務與成員 ────────────────────────────────────────────────────────────────


async def test_create_role_requires_resource_manager(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.post(
        f"/activities/{activity.id}/roles", json={"key": "staff", "name": "工作人員"}
    )
    assert response.status_code == 403


async def test_create_update_list_role(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/activities/{activity.id}/roles", json={"key": "staff", "name": "工作人員"}
    )
    assert create_resp.status_code == 201
    role_id = create_resp.json()["id"]

    update_resp = await ac.patch(
        f"/activities/{activity.id}/roles/{role_id}", json={"name": "資深工作人員"}
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "資深工作人員"

    list_resp = await ac.get(f"/activities/{activity.id}/roles")
    assert list_resp.status_code == 200
    assert any(row["id"] == role_id for row in list_resp.json())


async def test_appoint_and_remove_member(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    role_resp = await ac.post(
        f"/activities/{activity.id}/roles", json={"key": "staff", "name": "工作人員"}
    )
    role_id = role_resp.json()["id"]
    member_target = await make_user(email="activity-member@school.edu")

    appoint_resp = await ac.post(
        f"/activities/{activity.id}/members",
        json={
            "role_id": role_id,
            "user_id": str(member_target.id),
            "start_date": date.today().isoformat(),
        },
    )
    assert appoint_resp.status_code == 201
    member_id = appoint_resp.json()["id"]

    list_resp = await ac.get(f"/activities/{activity.id}/members")
    assert list_resp.status_code == 200
    assert any(row["id"] == member_id for row in list_resp.json())

    remove_resp = await ac.delete(f"/activities/{activity.id}/members/{member_id}")
    assert remove_resp.status_code == 204


# ── 跨模組關聯與工作區 ────────────────────────────────────────────────────────


async def test_create_and_delete_activity_link(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/activities/{activity.id}/links",
        json={
            "target_type": "document",
            "target_id": str(uuid.uuid4()),
            "title": "相關公文",
            "href": "/documents/abc",
        },
    )
    assert create_resp.status_code == 201
    link_id = create_resp.json()["id"]

    list_resp = await ac.get(f"/activities/{activity.id}/links")
    assert list_resp.status_code == 200
    assert any(row["id"] == link_id for row in list_resp.json())

    delete_resp = await ac.delete(f"/activities/{activity.id}/links/{link_id}")
    assert delete_resp.status_code == 204


async def test_create_link_requires_resource_manager(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.post(
        f"/activities/{activity.id}/links",
        json={
            "target_type": "document",
            "target_id": str(uuid.uuid4()),
            "title": "相關公文",
            "href": "/documents/abc",
        },
    )
    assert response.status_code == 403


async def test_get_activity_workspace(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/activities/{activity.id}/workspace")
    assert response.status_code == 200
    assert response.json()["activity_id"] == str(activity.id)


async def test_get_closing_report(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/activities/{activity.id}/closing-report")
    assert response.status_code == 200
    assert response.json()["activity_id"] == str(activity.id)


async def test_spawn_task_creates_work_item(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        f"/activities/{activity.id}/spawn",
        json={"kind": "task", "title": "採買物資"},
    )
    assert response.status_code == 201
    assert response.json()["kind"] == "task"
    assert response.json()["title"] == "採買物資"


async def test_spawn_requires_resource_manager(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.post(
        f"/activities/{activity.id}/spawn", json={"kind": "task", "title": "採買物資"}
    )
    assert response.status_code == 403


# ── Discord 工作區 ────────────────────────────────────────────────────────────


async def test_upsert_and_get_discord_workspace(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(admin_user)
    upsert_resp = await ac.put(
        f"/activities/{activity.id}/discord-workspace", json={"guild_id": "123456789"}
    )
    assert upsert_resp.status_code == 200
    assert upsert_resp.json()["guild_id"] == "123456789"

    get_resp = await ac.get(f"/activities/{activity.id}/discord-workspace")
    assert get_resp.status_code == 200
    assert get_resp.json()["guild_id"] == "123456789"

    sync_resp = await ac.post(f"/activities/{activity.id}/discord-workspace/sync")
    assert sync_resp.status_code == 200


async def test_upsert_discord_workspace_requires_resource_manager(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    activity = await _make_activity(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.put(
        f"/activities/{activity.id}/discord-workspace", json={"guild_id": "123456789"}
    )
    assert response.status_code == 403
