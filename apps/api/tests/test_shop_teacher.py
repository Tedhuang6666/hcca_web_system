"""教師商品訂購資料、處室管理及訂單快照的權限與持久化回歸。"""

import uuid

import pytest
from sqlalchemy import select

from api.models.shop_teacher import ShopOffice, ShopTeacherProfile
from api.schemas.shop import ClassOrderUpsert, OrderItemCreate, ProductCategoryCreate, ProductCreate
from api.services import shop as shop_svc


@pytest.fixture
async def teacher(make_user):
    return await make_user(email="teacher@hchs.hc.edu.tw", display_name="Google 帳號名稱")


async def test_office_management_permissions_and_validation(
    client, authed_client_factory, admin_user, teacher, make_user
):
    manager = authed_client_factory(admin_user)
    teacher_client = authed_client_factory(teacher)
    outsider = authed_client_factory(await make_user())
    for actor, code in [(client, 401), (teacher_client, 403), (outsider, 403)]:
        assert (await actor.get("/shop/offices")).status_code == code
        assert (await actor.post("/shop/offices", json={"name": "國文科"})).status_code == code
        assert (
            await actor.patch(f"/shop/offices/{uuid.uuid4()}", json={"name": "學務處"})
        ).status_code == code
        assert (
            await actor.patch(f"/shop/offices/{uuid.uuid4()}", json={"sort_order": 1})
        ).status_code == code
    created = await manager.post("/shop/offices", json={"name": " 國文科 "})
    assert created.status_code == 201, created.text
    office = created.json()
    assert office["name"] == "國文科"
    assert office["is_active"] is True
    assert office["sort_order"] == 0
    assert (await manager.post("/shop/offices", json={"name": "國文科"})).status_code == 409
    assert (await manager.post("/shop/offices", json={"name": "  "})).status_code == 422
    path = f"/shop/offices/{office['id']}"
    for payload in [
        {"name": None},
        {"is_active": None},
        {"name": " "},
        {"sort_order": None},
        {"sort_order": -1},
        {"sort_order": 1.5},
        {"sort_order": 2147483648},
    ]:
        assert (await manager.patch(path, json=payload)).status_code == 422
    updated = await manager.patch(path, json={"name": "學務處"})
    assert updated.json()["is_active"] is True  # 未提供的狀態必須保留。
    assert (await manager.patch(path, json={"is_active": False})).json()["name"] == "學務處"
    assert (await manager.get("/shop/offices")).json()[0]["is_active"] is False
    assert (await manager.patch(path, json={"is_active": True})).json()["is_active"] is True
    assert (await manager.patch(f"/shop/offices/{uuid.uuid4()}", json={})).status_code == 404


async def test_office_order_persists_for_managers_and_teachers(
    db_session, authed_client_factory, admin_user, teacher
):
    manager = authed_client_factory(admin_user)
    actor = authed_client_factory(teacher)
    first = (await manager.post("/shop/offices", json={"name": "教務處"})).json()
    second = (await manager.post("/shop/offices", json={"name": "學務處"})).json()
    inactive = (await manager.post("/shop/offices", json={"name": "已停用處室"})).json()
    await manager.patch(f"/shop/offices/{inactive['id']}", json={"is_active": False})
    updated = await manager.patch(f"/shop/offices/{first['id']}", json={"sort_order": 10})
    assert updated.status_code == 200, updated.text
    assert updated.json()["sort_order"] == 10
    assert updated.json()["name"] == first["name"]
    assert updated.json()["is_active"] is True
    stored = await db_session.get(ShopOffice, uuid.UUID(first["id"]))
    assert stored is not None
    db_session.expire(stored, ["sort_order"])
    assert [row["id"] for row in (await manager.get("/shop/offices")).json()] == [
        second["id"],
        inactive["id"],
        first["id"],
    ]
    expected = [second["id"], first["id"]]
    assert [
        row["id"] for row in (await actor.get("/shop/teacher-profile")).json()["offices"]
    ] == expected
    saved = await actor.put(
        "/shop/teacher-profile", json={"name": "王老師", "office_id": first["id"]}
    )
    assert [row["id"] for row in saved.json()["offices"]] == expected
    renamed = await manager.patch(f"/shop/offices/{first['id']}", json={"name": "新教務處"})
    assert renamed.json()["sort_order"] == 10
    added = (await manager.post("/shop/offices", json={"name": "總務處"})).json()
    assert added["sort_order"] == 11
    assert (await manager.get("/shop/offices")).json()[-1]["id"] == added["id"]


async def test_office_order_ties_and_limit_are_predictable(authed_client_factory, admin_user):
    manager = authed_client_factory(admin_user)
    offices = [
        (await manager.post("/shop/offices", json={"name": name})).json()
        for name in ["教務處", "學務處"]
    ]
    for office in offices:
        response = await manager.patch(
            f"/shop/offices/{office['id']}", json={"sort_order": 2147483647}
        )
        assert response.status_code == 200, response.text
    expected_ids = sorted(office["id"] for office in offices)
    assert [row["id"] for row in (await manager.get("/shop/offices")).json()] == expected_ids
    await manager.patch(f"/shop/offices/{offices[0]['id']}", json={"name": "新教務處"})
    assert [row["id"] for row in (await manager.get("/shop/offices")).json()] == expected_ids
    blocked = await manager.post("/shop/offices", json={"name": "總務處"})
    assert blocked.status_code == 422
    assert "請先降低" in blocked.json()["detail"]
    assert len((await manager.get("/shop/offices")).json()) == 2
    for index, office_id in enumerate(expected_ids):
        await manager.patch(f"/shop/offices/{office_id}", json={"sort_order": index})
    added = await manager.post("/shop/offices", json={"name": "總務處"})
    assert added.status_code == 201, added.text
    assert added.json()["sort_order"] == 2
    assert (await manager.get("/shop/offices")).json()[-1]["id"] == added.json()["id"]


async def test_teacher_can_only_save_own_profile(
    db_session, client, authed_client_factory, admin_user, teacher, make_user
):
    manager = authed_client_factory(admin_user)
    office = (await manager.post("/shop/offices", json={"name": "國文科"})).json()
    teacher_client = authed_client_factory(teacher)
    other = await make_user(email="other-teacher@hchs.hc.edu.tw")
    other_client = authed_client_factory(other)
    payload = {"name": " 王老師 ", "office_id": office["id"]}
    assert (await client.get("/shop/teacher-profile")).status_code == 401
    assert (await client.put("/shop/teacher-profile", json=payload)).status_code == 401
    for user in [
        await make_user(),
        await make_user(email="g0310001@hchs.hc.edu.tw", student_id="310001"),
    ]:
        actor = authed_client_factory(user)
        assert (await actor.get("/shop/teacher-profile")).json() is None
        assert (await actor.put("/shop/teacher-profile", json=payload)).status_code == 403
    initial = await teacher_client.get("/shop/teacher-profile")
    assert initial.json()["name"] is None
    assert initial.headers["cache-control"] == "private, no-store"
    saved = await teacher_client.put("/shop/teacher-profile", json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["name"] == "王老師"
    assert saved.json()["office_name"] == "國文科"
    assert (await other_client.get("/shop/teacher-profile")).json()["name"] is None
    forged = await other_client.put(
        "/shop/teacher-profile", json={**payload, "user_id": str(teacher.id)}
    )
    assert forged.status_code == 422
    assert teacher.display_name == "Google 帳號名稱"
    assert len(list(await db_session.scalars(select(ShopTeacherProfile)))) == 1
    for invalid in [{**payload, "name": " "}, {**payload, "office_id": str(uuid.uuid4())}]:
        assert (await teacher_client.put("/shop/teacher-profile", json=invalid)).status_code == 422
    await manager.patch(f"/shop/offices/{office['id']}", json={"is_active": False})
    assert (await teacher_client.get("/shop/teacher-profile")).json()["offices"] == []
    assert (await teacher_client.put("/shop/teacher-profile", json=payload)).status_code == 422


@pytest.mark.parametrize("flow", ["registration", "assisted"])
async def test_teacher_order_snapshots_survive_profile_and_office_changes(
    db_session, authed_client_factory, admin_user, teacher, flow
):
    manager = authed_client_factory(admin_user)
    actor = authed_client_factory(teacher)
    office = (await manager.post("/shop/offices", json={"name": "國文科"})).json()
    payload = {"name": "王老師", "office_id": office["id"]}
    assert (await actor.put("/shop/teacher-profile", json=payload)).status_code == 200
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="教師商品", slug="teacher-goods"),
        created_by=admin_user.id,
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(category_id=category.id, name="紀念品", price=100, stock_quantity=20),
        created_by=admin_user.id,
    )
    await shop_svc.activate_product(db_session, product)
    if flow == "registration":
        response = await actor.put(
            f"/shop/registrations/current/products/{product.id}",
            json={"variants": [{"option_ids": [], "quantity": 1}]},
        )
        assert response.status_code == 200, response.text
        order_id = uuid.UUID(response.json()["id"])
        assert response.json()["buyer_office"] == "國文科"
    else:
        orders = await shop_svc.create_direct_order(
            db_session,
            user_id=teacher.id,
            class_id=None,
            data=ClassOrderUpsert(
                user_id=teacher.id, items=[OrderItemCreate(product_id=product.id, quantity=1)]
            ),
        )
        order_id = orders[0].id
    order = await shop_svc.get_order(db_session, order_id)
    assert shop_svc.serialize_order(order).buyer_name == "王老師"
    assert shop_svc.serialize_order_list_item(order).user_name == "王老師"
    await actor.put("/shop/teacher-profile", json={**payload, "name": "新姓名"})
    await manager.patch(
        f"/shop/offices/{office['id']}", json={"name": "新處室", "is_active": False}
    )
    db_session.expire(order, ["buyer_name", "buyer_office"])
    order = await shop_svc.get_order(db_session, order_id)
    assert order.buyer_name == "王老師"
    assert order.buyer_office == "國文科"
    csv = await shop_svc.export_orders_csv(db_session)
    assert "王老師" in csv and "國文科" in csv
    assert "新姓名" not in csv and "新處室" not in csv
