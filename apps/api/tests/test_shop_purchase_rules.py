"""購買資格、跨商品限購與班聯指定票種的真實資料庫回歸。"""

from datetime import timedelta

import pytest
from sqlalchemy import func, select

from api.core.clock import local_today
from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.models.org import Org, Permission, Position, UserPosition
from api.models.shop import Order
from api.schemas.school_class import ClassStudentRangeCreate, SchoolClassCreate
from api.schemas.shop import (
    ClassOrderUpsert,
    OrderItemCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductPurchaseRules,
    ProductUpdate,
)
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.shop import _orders as orders_svc


@pytest.fixture
async def tickets(db_session, admin_user, make_user, authed_client_factory):
    student = await make_user(student_id="310001", email="g0310001@hchs.hc.edu.tw")
    other = await make_user(student_id="310002", email="g0310002@hchs.hc.edu.tw")
    school_class = await class_svc.create_class(
        db_session,
        data=SchoolClassCreate(
            academic_year=115,
            class_code="301",
            grade=3,
            ranges=[ClassStudentRangeCreate(student_id_start="310001", student_id_end="310040")],
        ),
        created_by=admin_user.id,
    )
    activity = Activity(name="演唱會", status=ActivityStatus.ACTIVE, is_active=True)
    db_session.add(activity)
    await db_session.flush()
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="票券", activity_id=activity.id),
        created_by=admin_user.id,
    )
    products = []
    for name, designated_only in (("一般預售票", False), ("工作票", True), ("表演票", True)):
        product = await shop_svc.create_product(
            db_session,
            data=ProductCreate(
                category_id=category.id,
                name=name,
                price=100 if not designated_only else 0,
                stock_quantity=20,
                purchase_rules=ProductPurchaseRules(
                    exclusive_group="115 演唱會", designated_only=designated_only
                ),
            ),
            created_by=admin_user.id,
        )
        await shop_svc.activate_product(db_session, product)
        products.append(product)
    return {
        "admin": authed_client_factory(admin_user),
        "student": authed_client_factory(student),
        "other": authed_client_factory(other),
        "buyer": student,
        "other_buyer": other,
        "products": products,
        "class": school_class,
        "activity": activity,
        "category": category,
        "admin_user": admin_user,
    }


def registration(product, quantity=1):
    return f"/shop/registrations/current/products/{product.id}", {
        "variants": [{"option_ids": [], "quantity": quantity}] if quantity else [],
    }


async def test_rules_roundtrip_privacy_and_patch_semantics(tickets, client):
    product = tickets["products"][0]
    path = f"/shop/products/{product.id}"
    rules = {
        "allowed_grades": [3],
        "allowed_identifiers": [" 310001 ", "G0310001@HCHS.HC.EDU.TW"],
        "blocked_identifiers": ["310002"],
        "required_permissions": [],
    }
    assert (await client.get(path + "/purchase-rules")).status_code == 401
    assert (await tickets["student"].get(path + "/purchase-rules")).status_code == 403
    assert (await tickets["student"].patch(path, json={"purchase_rules": rules})).status_code == 403
    assert (await tickets["admin"].patch(path, json={"purchase_rules": rules})).status_code == 200
    stored = (await tickets["admin"].get(path + "/purchase-rules")).json()
    assert stored["allowed_identifiers"] == ["310001", "g0310001@hchs.hc.edu.tw"]
    assert (await tickets["admin"].patch(path, json={"name": "優待票"})).status_code == 200
    assert (await tickets["admin"].get(path + "/purchase-rules")).json() == stored
    for endpoint in (path, "/shop/products", "/shop/catalog"):
        public = await client.get(endpoint)
        assert public.status_code == (404 if endpoint == path else 200)
        assert "310001" not in public.text and "310002" not in public.text
        assert "purchase_rules" not in public.text
    assert (await tickets["student"].get(path)).json()["purchase_allowed"] is True
    assert (await tickets["other"].get(path)).json()["purchase_allowed"] is False
    assert (await tickets["admin"].patch(path, json={"purchase_rules": None})).status_code == 200
    assert (await tickets["other"].get(path)).json()["purchase_allowed"] is True


@pytest.mark.parametrize(
    "rules",
    [
        {"allowed_grades": [1]},
        {"allowed_identifiers": ["999999"]},
        {"required_permissions": ["shop:manage"]},
        {"allowed_identifiers": ["310001"], "blocked_identifiers": ["g0310001@hchs.hc.edu.tw"]},
    ],
)
async def test_restrictions_are_enforced_at_registration(tickets, rules):
    product = tickets["products"][0]
    assert (
        await tickets["admin"].patch(f"/shop/products/{product.id}", json={"purchase_rules": rules})
    ).status_code == 200
    path, body = registration(product)
    response = await tickets["student"].put(path, json=body)
    assert response.status_code == 409, response.text


async def test_grade_permission_and_allowlist_all_required_with_current_tenure(tickets, db_session):
    user = tickets["buyer"]
    org = Org(name="班聯")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="工作人員")
    db_session.add(position)
    await db_session.flush()
    tenure = UserPosition(
        user_id=user.id,
        position_id=position.id,
        start_date=local_today() - timedelta(days=10),
        end_date=local_today() - timedelta(days=1),
    )
    db_session.add_all([Permission(position_id=position.id, code="shop:manage"), tenure])
    await db_session.flush()
    product = tickets["products"][0]
    rules = ProductPurchaseRules(
        allowed_grades=[3],
        required_permissions=["shop:manage"],
        allowed_identifiers=[user.student_id],
    )
    await shop_svc.update_product(db_session, product, data=ProductUpdate(purchase_rules=rules))
    path, body = registration(product)
    assert (await tickets["student"].put(path, json=body)).status_code == 409
    tenure.end_date = None
    await db_session.flush()
    response = await tickets["student"].put(path, json=body)
    assert response.status_code == 200, response.text


async def test_same_group_rejects_two_products_in_one_order_and_cumulative_purchases(
    tickets, db_session
):
    normal, work, _ = tickets["products"]
    await shop_svc.update_product(
        db_session,
        work,
        data=ProductUpdate(purchase_rules=ProductPurchaseRules(exclusive_group="115 演唱會")),
    )
    with pytest.raises(ValueError, match="只能訂購一件"):
        await shop_svc.create_direct_order(
            db_session,
            user_id=tickets["buyer"].id,
            class_id=tickets["class"].id,
            data=ClassOrderUpsert(
                user_id=tickets["buyer"].id,
                items=[
                    OrderItemCreate(product_id=normal.id, quantity=1),
                    OrderItemCreate(product_id=work.id, quantity=1),
                ],
            ),
        )
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0
    path, body = registration(normal)
    assert (await tickets["student"].put(path, json=body)).status_code == 200
    path, body = registration(work)
    assert (await tickets["student"].put(path, json=body)).status_code == 409
    path, body = registration(normal, 2)
    assert (await tickets["student"].put(path, json=body)).status_code == 409


async def test_designated_eligibility_blocks_other_tickets_before_checkout(tickets, db_session):
    normal, work, show = tickets["products"]
    path = f"/shop/products/{work.id}"
    rules = {
        "exclusive_group": "115 演唱會",
        "designated_only": True,
        "allowed_identifiers": ["310001"],
    }
    assert (await tickets["student"].patch(path, json={"purchase_rules": rules})).status_code == 403
    assert (await tickets["admin"].patch(path, json={"purchase_rules": rules})).status_code == 200
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0
    for product, allowed in ((normal, False), (work, True), (show, False)):
        detail = await tickets["student"].get(f"/shop/products/{product.id}")
        assert detail.json()["purchase_allowed"] is allowed
    assert (await tickets["other"].get(f"/shop/products/{normal.id}")).json()[
        "purchase_allowed"
    ] is True
    route, body = registration(normal)
    assert (await tickets["student"].put(route, json=body)).status_code == 409
    route, body = registration(work)
    bought = await tickets["student"].put(route, json=body)
    assert bought.status_code == 200, bought.text
    assert bought.json()["items"][0]["quantity"] == 1
    # 學生可以取消訂購，但不能藉此解除班聯指定的票種限制。
    route, body = registration(work, 0)
    assert (await tickets["student"].put(route, json=body)).status_code == 200
    route, body = registration(normal)
    assert (await tickets["student"].put(route, json=body)).status_code == 409
    route, body = registration(work)
    assert (await tickets["student"].put(route, json=body)).status_code == 200
    # 班聯移除指定名單後，同組一般票才可重新購買。
    route, body = registration(work, 0)
    assert (await tickets["student"].put(route, json=body)).status_code == 200
    rules["allowed_identifiers"] = []
    assert (await tickets["admin"].patch(path, json={"purchase_rules": rules})).status_code == 200
    route, body = registration(normal)
    assert (await tickets["student"].put(route, json=body)).status_code == 200


async def test_conflicting_designations_fail_closed_even_with_email_student_alias(tickets):
    normal, work, show = tickets["products"]
    for product, identifier in ((work, "310001"), (show, "g0310001@hchs.hc.edu.tw")):
        response = await tickets["admin"].patch(
            f"/shop/products/{product.id}",
            json={
                "purchase_rules": {
                    "exclusive_group": "115 演唱會",
                    "designated_only": True,
                    "allowed_identifiers": [identifier],
                }
            },
        )
        assert response.status_code == 200
    for product in (normal, work, show):
        route, body = registration(product)
        assert (await tickets["student"].put(route, json=body)).status_code == 409
        assert (await tickets["student"].get(f"/shop/products/{product.id}")).json()[
            "purchase_allowed"
        ] is False


async def test_delegation_uses_students_designated_ticket(tickets):
    normal, work, _ = tickets["products"]
    link_response = await tickets["student"].post(
        "/shop/delegation-links",
        json={
            "category_id": str(tickets["category"].id),
            "name": "家人",
        },
    )
    assert link_response.status_code == 201, link_response.text
    token = link_response.json()["token"]
    assert (
        await tickets["other"].post("/shop/delegation/access", json={"token": token, "claim": True})
    ).status_code == 200
    assert (
        await tickets["admin"].patch(
            f"/shop/products/{work.id}",
            json={
                "purchase_rules": {
                    "exclusive_group": "115 演唱會",
                    "designated_only": True,
                    "allowed_identifiers": ["310001"],
                }
            },
        )
    ).status_code == 200
    result = await tickets["other"].post(
        f"/shop/delegation/products/{normal.id}",
        json={
            "token": token,
            "variants": [{"option_ids": [], "quantity": 1}],
        },
    )
    assert result.status_code == 409, result.text
    detail = await tickets["other"].post(
        f"/shop/delegation/products/{normal.id}/read", json={"token": token}
    )
    assert detail.status_code == 200 and detail.json()["purchase_allowed"] is False
    allowed = await tickets["other"].post(
        f"/shop/delegation/products/{work.id}",
        json={
            "token": token,
            "variants": [{"option_ids": [], "quantity": 1}],
        },
    )
    assert allowed.status_code == 200, allowed.text


async def test_activity_convener_cannot_read_other_activity_rules(
    tickets, db_session, make_user, authed_client_factory
):
    convener = await make_user()
    other_activity = Activity(name="其他活動", status=ActivityStatus.ACTIVE, is_active=True)
    db_session.add(other_activity)
    await db_session.flush()
    db_session.add(
        ActivityConvener(
            activity_id=other_activity.id, user_id=convener.id, start_date=local_today()
        )
    )
    await db_session.flush()
    actor = authed_client_factory(convener)
    product = tickets["products"][1]
    for suffix in ("/purchase-rules",):
        assert (await actor.get(f"/shop/products/{product.id}" + suffix)).status_code == 403
    assert (
        await actor.get(f"/shop/purchase-permissions?activity_id={tickets['activity'].id}")
    ).status_code == 403
    assert (
        await actor.get(f"/shop/purchase-permissions?activity_id={other_activity.id}")
    ).status_code == 200


@pytest.mark.parametrize(
    "rules",
    [
        {"allowed_grades": [4]},
        {"required_permissions": ["fake:permission"]},
        {"allowed_identifiers": ["王同學"]},
    ],
)
async def test_invalid_rules_rejected_without_erasing_current_policy(tickets, rules):
    product = tickets["products"][0]
    path = f"/shop/products/{product.id}"
    assert (await tickets["admin"].patch(path, json={"purchase_rules": rules})).status_code == 422
    assert (await tickets["admin"].get(path + "/purchase-rules")).json()[
        "exclusive_group"
    ] == "115 演唱會"


async def test_cart_rechecks_rules_at_checkout_and_enforces_group(tickets, db_session):
    from api.schemas.shop import CartItemCreate

    normal, work, _ = tickets["products"]
    user = tickets["buyer"]
    await shop_svc.update_product(
        db_session,
        work,
        data=ProductUpdate(purchase_rules=ProductPurchaseRules(exclusive_group="115 演唱會")),
    )
    await orders_svc.add_cart_item(
        db_session, user.id, data=CartItemCreate(product_id=normal.id, quantity=1)
    )
    with pytest.raises(ValueError, match="只能訂購一件"):
        await orders_svc.add_cart_item(
            db_session, user.id, data=CartItemCreate(product_id=work.id, quantity=1)
        )
    await shop_svc.update_product(
        db_session,
        normal,
        data=ProductUpdate(
            purchase_rules=ProductPurchaseRules(blocked_identifiers=[user.student_id])
        ),
    )
    with pytest.raises(ValueError, match="禁止購買"):
        await orders_svc.checkout(db_session, user)
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0


async def test_designated_ticket_requires_group_and_empty_list_blocks_purchase(tickets):
    work = tickets["products"][1]
    path = f"/shop/products/{work.id}"
    assert (
        await tickets["admin"].patch(path, json={"purchase_rules": {"designated_only": True}})
    ).status_code == 422
    route, body = registration(work)
    assert (await tickets["student"].put(route, json=body)).status_code == 409


async def test_school_email_matches_designated_student_id_before_profile_link(tickets, db_session):
    normal, work, _ = tickets["products"]
    tickets["buyer"].student_id = None
    await db_session.flush()
    await shop_svc.update_product(
        db_session,
        work,
        data=ProductUpdate(
            purchase_rules=ProductPurchaseRules(
                exclusive_group="115 演唱會",
                designated_only=True,
                allowed_identifiers=["310001"],
            )
        ),
    )
    assert (await tickets["student"].get(f"/shop/products/{work.id}")).json()[
        "purchase_allowed"
    ] is True
    assert (await tickets["student"].get(f"/shop/products/{normal.id}")).json()[
        "purchase_allowed"
    ] is False
    path, body = registration(work)
    response = await tickets["student"].put(path, json=body)
    assert response.status_code == 200, response.text


async def test_group_selection_lists_all_theme_products_and_syncs_members(
    tickets, db_session, client
):
    from api.schemas.shop import ProductSeriesCreate

    normal, work, show = tickets["products"]
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=tickets["category"].id, name="系列")
    )
    extra = await shop_svc.create_product(
        db_session,
        data=ProductCreate(series_id=series.id, name="系列票", price=10),
        created_by=tickets["admin_user"].id,
    )
    path = f"/shop/purchase-group-options?category_id={tickets['category'].id}"
    assert (await client.get(path)).status_code == 401
    assert (await tickets["student"].get(path)).status_code == 403
    options = await tickets["admin"].get(path)
    assert {item["id"] for item in options.json()} == {
        str(p.id) for p in (normal, work, show, extra)
    }
    group_ids = [str(work.id), str(show.id), str(extra.id)]
    response = await tickets["admin"].patch(
        f"/shop/products/{normal.id}", json={"purchase_rules": {"exclusive_product_ids": group_ids}}
    )
    assert response.status_code == 200, response.text
    for product in (normal, work, show, extra):
        rules = (await tickets["admin"].get(f"/shop/products/{product.id}/purchase-rules")).json()
        assert set(rules["exclusive_product_ids"]) == set(group_ids) | {str(normal.id)}
    # 重新選擇兩項，未選中的商品保留在原組，所選商品同步到新組。
    response = await tickets["admin"].patch(
        f"/shop/products/{normal.id}",
        json={
            "purchase_rules": {
                "exclusive_product_ids": [str(normal.id), str(extra.id)],
            }
        },
    )
    assert response.status_code == 200, response.text
    for product in (normal, extra):
        rules = (await tickets["admin"].get(f"/shop/products/{product.id}/purchase-rules")).json()
        assert set(rules["exclusive_product_ids"]) == {str(normal.id), str(extra.id)}


async def test_group_selection_rejects_other_themes(tickets, db_session):
    normal = tickets["products"][0]
    other_category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="其他主題"), created_by=tickets["admin_user"].id
    )
    other = await shop_svc.create_product(
        db_session,
        data=ProductCreate(category_id=other_category.id, name="其他票", price=100),
        created_by=tickets["admin_user"].id,
    )
    result = await tickets["admin"].patch(
        f"/shop/products/{normal.id}",
        json={"purchase_rules": {"exclusive_product_ids": [str(other.id)]}},
    )
    assert result.status_code == 409 and "同一商品主題" in result.text
