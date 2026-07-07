"""工作分配路由測試（apps/api/src/api/routers/work_items.py）。"""

from __future__ import annotations


async def test_create_work_item_without_login_returns_401(client) -> None:
    resp = await client.post("/work-items", json={"title": "測試工作"})
    assert resp.status_code == 401


async def test_create_and_list_own_work_item(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)

    # /work-items 預設列出「指派給自己」的項目（見 list_work_items 的
    # assigned_to_id == target_id 篩選），不是「自己建立的所有項目」，
    # 所以要指派給自己才會出現在清單。
    created = await ac.post(
        "/work-items",
        json={"title": "整理會議紀錄", "assigned_to_id": str(member_user.id)},
    )
    assert created.status_code == 201
    item_id = created.json()["id"]

    listed = await ac.get("/work-items")
    assert listed.status_code == 200
    assert any(row["id"] == item_id for row in listed.json())


async def test_create_work_item_assigned_to_other_user_notifies_them(
    member_user, make_user, authed_client_factory
) -> None:
    assignee = await make_user(email="assignee@school.edu")
    ac = authed_client_factory(member_user)

    resp = await ac.post(
        "/work-items",
        json={"title": "審核提案", "assigned_to_id": str(assignee.id)},
    )

    assert resp.status_code == 201
    assert resp.json()["assigned_to_id"] == str(assignee.id)


async def test_update_missing_work_item_returns_404(member_user, authed_client_factory) -> None:
    import uuid

    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/work-items/{uuid.uuid4()}", json={"title": "x"})
    assert resp.status_code == 404


async def test_update_work_item_by_unrelated_user_returns_403(
    member_user, make_user, authed_client_factory
) -> None:
    creator = await make_user(email="wi-creator@school.edu")
    creator_client = authed_client_factory(creator)
    created = await creator_client.post("/work-items", json={"title": "僅建立者可改"})
    item_id = created.json()["id"]

    stranger_client = authed_client_factory(member_user)
    resp = await stranger_client.patch(f"/work-items/{item_id}", json={"title": "亂改"})

    assert resp.status_code == 403


async def test_complete_work_item_by_assignee_succeeds(
    member_user, make_user, authed_client_factory
) -> None:
    creator = await make_user(email="wi-creator2@school.edu")
    creator_client = authed_client_factory(creator)
    created = await creator_client.post(
        "/work-items",
        json={"title": "待完成事項", "assigned_to_id": str(member_user.id)},
    )
    item_id = created.json()["id"]

    assignee_client = authed_client_factory(member_user)
    resp = await assignee_client.post(f"/work-items/{item_id}/complete")

    assert resp.status_code == 200
    assert resp.json()["status"] == "done"


async def test_complete_work_item_by_unrelated_user_returns_403(
    member_user, make_user, authed_client_factory
) -> None:
    creator = await make_user(email="wi-creator3@school.edu")
    creator_client = authed_client_factory(creator)
    created = await creator_client.post("/work-items", json={"title": "無人指派"})
    item_id = created.json()["id"]

    stranger_client = authed_client_factory(member_user)
    resp = await stranger_client.post(f"/work-items/{item_id}/complete")

    assert resp.status_code == 403


async def test_complete_missing_work_item_returns_404(member_user, authed_client_factory) -> None:
    import uuid

    ac = authed_client_factory(member_user)
    resp = await ac.post(f"/work-items/{uuid.uuid4()}/complete")
    assert resp.status_code == 404


async def test_superuser_can_update_any_work_item(
    admin_user, make_user, authed_client_factory
) -> None:
    creator = await make_user(email="wi-creator4@school.edu")
    creator_client = authed_client_factory(creator)
    created = await creator_client.post("/work-items", json={"title": "任何人建立"})
    item_id = created.json()["id"]

    admin_client = authed_client_factory(admin_user)
    resp = await admin_client.patch(f"/work-items/{item_id}", json={"title": "管理員改"})

    assert resp.status_code == 200
    assert resp.json()["title"] == "管理員改"
