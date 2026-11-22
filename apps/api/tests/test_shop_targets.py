"""商品管理選人：姓名搜尋、名單核對與活動範圍。"""

import pytest

from api.core.clock import local_today
from api.models.activity import Activity, ActivityConvener
from api.models.org import Org, Permission, Position, UserPosition
from api.models.person import Person
from api.models.school_class import ClassRosterEntry, SchoolClass
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory


async def test_search_and_batch_lookup_preserve_identity_and_show_roster(
    db_session, make_user, admin_user, authed_client_factory
):
    user = await make_user(student_id="310001", display_name="登入暱稱")
    db_session.add_all(
        [
            Person(
                user_id=user.id,
                student_id="310001",
                display_name="測試同學",
                legal_name="測試本名",
                note="不應公開的備註",
            ),
            Person(student_id="310002", display_name="測試本名"),
        ]
    )
    school_class = SchoolClass(
        academic_year=115, class_code="301", grade=3, label="三年一班", created_by=admin_user.id
    )
    db_session.add(school_class)
    await db_session.flush()
    db_session.add(
        ClassRosterEntry(
            class_id=school_class.id, user_id=user.id, student_id="310001", seat_number=1
        )
    )
    await db_session.flush()
    actor = authed_client_factory(admin_user)

    response = await actor.post("/shop/target-options", json={"keyword": "測試本名"})
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    rows = response.json()
    assert [row["identifier"] for row in rows] == ["310001", "310002"]
    assert rows[0]["display_name"] == "測試本名"
    assert rows[0]["class_label"] == "三年一班"
    assert rows[0]["seat_number"] == 1
    assert rows[0]["account_active"] is True
    assert rows[1]["account_active"] is None
    assert "note" not in rows[0]

    response = await actor.post(
        "/shop/target-options",
        json={"identifiers": [user.email.upper(), "310002", "399999", "310002"]},
    )
    rows = response.json()
    assert [row["identifier"] for row in rows] == [user.email, "310002", "399999"]
    assert rows[0]["student_id"] == "310001"
    assert rows[0]["class_label"] == "三年一班"
    assert rows[1]["matched"] is True
    assert rows[2]["matched"] is False


async def test_lookup_includes_accounts_without_people_and_roster_without_accounts(
    db_session, make_user, admin_user, authed_client_factory
):
    user = await make_user(display_name="外部測試帳號", is_active=False)
    school_class = SchoolClass(
        academic_year=115, class_code="302", grade=3, created_by=admin_user.id
    )
    db_session.add(school_class)
    await db_session.flush()
    db_session.add(ClassRosterEntry(class_id=school_class.id, student_id="310003", seat_number=3))
    await db_session.flush()
    actor = authed_client_factory(admin_user)
    response = await actor.post("/shop/target-options", json={"keyword": "外部測試"})
    assert response.status_code == 200, response.text
    assert response.json()[0]["identifier"] == user.email
    assert response.json()[0]["account_active"] is False
    response = await actor.post("/shop/target-options", json={"identifiers": ["310003"]})
    assert response.json()[0]["class_label"] == "302 班"
    assert response.json()[0]["matched"] is True
    assert response.json()[0]["display_name"] is None


async def test_target_lookup_requires_permission_and_respects_activity_scope(
    client, db_session, make_user, authed_client_factory
):
    user = await make_user()
    actor = authed_client_factory(user)
    assert (await client.post("/shop/target-options", json={"keyword": "測試"})).status_code == 401
    assert (await actor.post("/shop/target-options", json={"keyword": "測試"})).status_code == 403
    activity = Activity(name="可管理活動")
    other = Activity(name="其他活動")
    db_session.add_all([activity, other])
    await db_session.flush()
    db_session.add(
        ActivityConvener(activity_id=activity.id, user_id=user.id, start_date=local_today())
    )
    await db_session.flush()
    response = await actor.post(
        "/shop/target-options", json={"activity_id": str(activity.id), "keyword": "測試"}
    )
    assert response.status_code == 200, response.text
    response = await actor.post(
        "/shop/target-options", json={"activity_id": str(other.id), "keyword": "測試"}
    )
    assert response.status_code == 403
    assert (await actor.post("/shop/target-options", json={"keyword": "測試"})).status_code == 403


async def test_empty_search_and_wildcards_do_not_list_everyone(
    admin_user, make_user, authed_client_factory
):
    await make_user(display_name="搜尋測試")
    actor = authed_client_factory(admin_user)
    for keyword in ("", "  ", "%", "_"):
        response = await actor.post("/shop/target-options", json={"keyword": keyword})
        assert response.status_code == 200, response.text
        assert response.json() == []


async def test_shop_manager_can_search_without_people_management_permission(
    db_session, make_user, authed_client_factory
):
    user = await make_user()
    org = Org(name="測試商品管理組")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="商品管理員")
    db_session.add(position)
    await db_session.flush()
    db_session.add_all(
        [
            Permission(position_id=position.id, code="shop:manage"),
            UserPosition(user_id=user.id, position_id=position.id, start_date=local_today()),
        ]
    )
    await db_session.flush()
    actor = authed_client_factory(user)
    assert (await actor.get("/people", params={"keyword": "測試"})).status_code == 403
    response = await actor.post("/shop/target-options", json={"keyword": "測試"})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("status", "test_order", "quantity", "expected"),
    [
        (OrderStatus.PENDING, False, 1, True),
        (OrderStatus.CONFIRMED, False, 2, True),
        (OrderStatus.CANCELLED, False, 1, False),
        (OrderStatus.REFUNDED, False, 1, False),
        (OrderStatus.PENDING, True, 1, False),
        (OrderStatus.PENDING, False, 0, False),
    ],
)
async def test_product_target_order_status_uses_buyer_and_valid_items(
    db_session, make_user, admin_user, authed_client_factory, status, test_order, quantity, expected
):
    buyer = await make_user(email="g0310001@hchs.hc.edu.tw")
    category = ProductCategory(name="商品名單測試", created_by=admin_user.id)
    db_session.add(category)
    await db_session.flush()
    product = Product(category_id=category.id, name="目標商品", price=100, created_by=admin_user.id)
    other_product = Product(
        category_id=category.id, name="其他商品", price=100, created_by=admin_user.id
    )
    db_session.add_all([product, other_product])
    await db_session.flush()
    order = Order(
        serial_number="ORD-TARGET-1",
        user_id=buyer.id,
        assisted_by_id=admin_user.id,
        assistance_scope="admin",
        status=status,
        test_product_id=product.id if test_order else None,
    )
    db_session.add(order)
    await db_session.flush()
    db_session.add(
        OrderItem(
            order_id=order.id,
            product_id=product.id,
            quantity=quantity,
            unit_price=100,
        )
    )
    await db_session.flush()
    actor = authed_client_factory(admin_user)
    for identifier in ("310001", buyer.email):
        response = await actor.post(
            "/shop/target-options",
            json={"product_id": str(product.id), "identifiers": [identifier, "399999"]},
        )
        assert response.status_code == 200, response.text
        assert response.json()[0]["has_ordered"] is expected
        assert response.json()[1]["has_ordered"] is False
    response = await actor.post(
        "/shop/target-options",
        json={"product_id": str(other_product.id), "identifiers": [buyer.email]},
    )
    assert response.json()[0]["has_ordered"] is False
    response = await actor.post("/shop/target-options", json={"identifiers": [buyer.email]})
    assert response.json()[0]["has_ordered"] is None


async def test_product_target_status_checks_actual_product_activity(
    db_session, make_user, admin_user, client, authed_client_factory
):
    user = await make_user()
    activities = [Activity(name="可管理"), Activity(name="不可管理")]
    db_session.add_all(activities)
    await db_session.flush()
    db_session.add(
        ActivityConvener(activity_id=activities[0].id, user_id=user.id, start_date=local_today())
    )
    products = []
    for activity in activities:
        category = ProductCategory(
            name=activity.name, activity_id=activity.id, created_by=admin_user.id
        )
        db_session.add(category)
        await db_session.flush()
        product = Product(
            category_id=category.id, name="名單商品", price=100, created_by=admin_user.id
        )
        db_session.add(product)
        products.append(product)
    await db_session.flush()
    payload = {
        "activity_id": str(activities[0].id),
        "product_id": str(products[1].id),
        "identifiers": ["310001"],
    }
    assert (await client.post("/shop/target-options", json=payload)).status_code == 401
    actor = authed_client_factory(user)
    assert (await actor.post("/shop/target-options", json=payload)).status_code == 403
    payload["product_id"] = str(products[0].id)
    response = await actor.post("/shop/target-options", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()[0]["has_ordered"] is False
    outsider = authed_client_factory(await make_user())
    assert (await outsider.post("/shop/target-options", json=payload)).status_code == 403


async def test_product_notes_persist_privately_and_removed_people_lose_notes(
    db_session, admin_user, make_user, authed_client_factory
):
    category = ProductCategory(name="備註測試", created_by=admin_user.id)
    db_session.add(category)
    await db_session.flush()
    actor = authed_client_factory(admin_user)
    response = await actor.post(
        "/shop/products",
        json={
            "category_id": str(category.id),
            "name": "名單備註商品",
            "price": 100,
            "purchase_rules": {
                "allowed_identifiers": ["310001", "310002"],
                "identifier_notes": {
                    " 310001 ": " 工作人員 ",
                    "310002": "待確認",
                    "399999": "移除",
                },
            },
        },
    )
    assert response.status_code == 201, response.text
    product_id = response.json()["id"]
    rules_url = f"/shop/products/{product_id}/purchase-rules"
    response = await actor.get(rules_url)
    assert response.json()["identifier_notes"] == {"310001": "工作人員", "310002": "待確認"}
    response = await actor.patch(
        f"/shop/products/{product_id}",
        json={
            "purchase_rules": {
                "allowed_identifiers": ["310001"],
                "identifier_notes": {"310001": "已聯絡", "310002": "待確認"},
            }
        },
    )
    assert response.status_code == 200, response.text
    assert (await actor.get(rules_url)).json()["identifier_notes"] == {"310001": "已聯絡"}
    response = await actor.patch(
        f"/shop/products/{product_id}",
        json={
            "purchase_rules": {
                "allowed_identifiers": ["310001"],
                "identifier_notes": {"310001": "字" * 501},
            }
        },
    )
    assert response.status_code == 422
    outsider = authed_client_factory(await make_user())
    assert (await outsider.get(rules_url)).status_code == 403
    response = await actor.get(f"/shop/products/{product_id}")
    assert "identifier_notes" not in response.text
    assert "已聯絡" not in response.text
