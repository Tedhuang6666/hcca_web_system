"""活動統一結單優先於單品延長，所有訂購入口一致。"""

from datetime import UTC, date, datetime, timedelta

import pytest

from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.schemas.shop import (
    CartItemCreate,
    ClassOrderUpsert,
    OrderItemCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductSeriesCreate,
)
from api.services import shop as shop_svc
from api.services.shop._deadlines import recently_closed_product_ids


@pytest.fixture
async def deadline_setup(db_session, admin_user, make_user):
    buyer = await make_user(student_id="310001", email="310001@hchs.hc.edu.tw")
    closed = Activity(
        name="已結單活動",
        status=ActivityStatus.ACTIVE,
        order_closes_at=datetime.now(UTC) - timedelta(hours=1),
    )
    other = Activity(name="另一個預購活動", status=ActivityStatus.ACTIVE)
    db_session.add_all([closed, other])
    await db_session.flush()
    products = []
    categories = []
    for index, activity in enumerate([closed, closed, other]):
        category = await shop_svc.create_category(
            db_session,
            data=ProductCategoryCreate(name=f"主題{index}", activity_id=activity.id),
            created_by=admin_user.id,
        )
        series = None
        if index == 1:
            series = await shop_svc.create_series(
                db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
            )
        product = await shop_svc.create_product(
            db_session,
            data=ProductCreate(
                category_id=category.id,
                series_id=series.id if series else None,
                name=f"商品{index}",
                price=100,
                stock_quantity=20,
            ),
            created_by=admin_user.id,
        )
        await shop_svc.activate_product(db_session, product)
        categories.append(category)
        products.append(product)
    return buyer, closed, other, categories, products


async def test_activity_deadline_permissions_scope_null_and_timezone(
    db_session, client, admin_user, make_user, authed_client_factory, deadline_setup
):
    buyer, activity, other, _, _ = deadline_setup
    path = f"/shop/activities/{activity.id}/order-deadline"
    payload = {"order_closes_at": "2030-10-22T20:00:00+08:00"}
    assert (await client.patch(path, json=payload)).status_code == 401
    assert (await authed_client_factory(buyer).patch(path, json=payload)).status_code == 403
    convener = await make_user()
    db_session.add(
        ActivityConvener(
            activity_id=activity.id,
            user_id=convener.id,
            start_date=date.today(),
        )
    )
    await db_session.flush()
    ac = authed_client_factory(convener)
    assert (
        await ac.patch(f"/shop/activities/{other.id}/order-deadline", json=payload)
    ).status_code == 403
    response = await ac.patch(path, json=payload)
    assert response.status_code == 200
    assert datetime.fromisoformat(response.json()["order_closes_at"]) == datetime(
        2030, 10, 22, 12, tzinfo=UTC
    )
    assert (await ac.patch(path, json={})).status_code == 422
    assert (await ac.patch(path, json={"order_closes_at": "2030-10-22T20:00"})).status_code == 422
    cleared = await authed_client_factory(admin_user).patch(path, json={"order_closes_at": None})
    assert cleared.status_code == 200
    assert cleared.json()["order_closes_at"] is None


async def test_unified_deadline_caps_categories_and_product_extensions(
    client,
    admin_user,
    authed_client_factory,
    deadline_setup,
):
    buyer, activity, _, categories, products = deadline_setup
    ac = authed_client_factory(buyer)
    for product in products[:2]:
        response = await ac.put(
            f"/shop/registrations/current/products/{product.id}",
            json={"variants": [{"option_ids": [], "quantity": 1}]},
        )
        assert response.status_code == 409
        assert "已截止登記" in response.json()["detail"]

    extended = products[1]
    later = datetime.now(UTC) + timedelta(days=1)
    manager = authed_client_factory(admin_user)
    response = await manager.patch(
        f"/shop/products/{extended.id}", json={"sale_end": later.isoformat()}
    )
    assert response.status_code == 200
    assert datetime.fromisoformat(response.json()["effective_sale_end"]) == activity.order_closes_at
    public_catalog = (await client.get("/shop/catalog")).json()
    assert str(categories[0].id) not in {row["id"] for row in public_catalog}
    catalog = (await manager.get("/shop/catalog", params={"include_closed": True})).json()
    first = next(row for row in catalog if row["id"] == str(categories[0].id))
    second = next(row for row in catalog if row["id"] == str(categories[1].id))
    assert (
        datetime.fromisoformat(first["products"][0]["effective_sale_end"])
        == activity.order_closes_at
    )
    assert first["products"][0]["sale_end"] is None
    assert (
        datetime.fromisoformat(second["series"][0]["products"][0]["effective_sale_end"])
        == activity.order_closes_at
    )
    for product, expected in [(extended, 409), (products[2], 200)]:
        response = await ac.put(
            f"/shop/registrations/current/products/{product.id}",
            json={"variants": [{"option_ids": [], "quantity": 1}]},
        )
        assert response.status_code == expected
    orders = (await ac.get("/shop/registrations")).json()
    assert len(orders) == 1
    # 舊資料未填 category_id 的系列商品也必須沿用活動期限。
    extended.category_id = None
    await manager.patch(f"/shop/products/{extended.id}", json={"sale_end": None})
    details = (await client.get(f"/shop/products/{extended.id}")).json()
    assert details["sale_end"] is None
    assert datetime.fromisoformat(details["effective_sale_end"]) == activity.order_closes_at
    blocked = await ac.put(
        f"/shop/registrations/current/products/{extended.id}",
        json={"variants": []},
    )
    assert blocked.status_code == 409


async def test_cart_remains_unavailable_after_unified_deadline(db_session, deadline_setup):
    buyer, _, _, _, products = deadline_setup
    buyer_id = buyer.id
    product = products[0]
    await shop_svc.add_cart_item(
        db_session,
        buyer.id,
        data=CartItemCreate(product_id=product.id, quantity=1),
    )
    db_session.expire_all()
    cart = await shop_svc.get_or_create_cart(db_session, buyer_id)
    assert shop_svc.serialize_cart(cart).items[0].available is False
    cart.items[0].product.sale_end = datetime.now(UTC) + timedelta(days=1)
    await db_session.flush()
    assert shop_svc.serialize_cart(cart).items[0].available is False


async def test_parent_link_cannot_extend_past_unified_deadline(
    db_session,
    admin_user,
    authed_client_factory,
    deadline_setup,
):
    buyer, activity, _, categories, products = deadline_setup
    activity.order_closes_at = datetime.now(UTC) + timedelta(days=1)
    await db_session.flush()
    link = await authed_client_factory(buyer).post(
        "/shop/delegation-links",
        json={"name": "家人", "category_id": str(categories[0].id)},
    )
    assert link.status_code == 201
    activity.order_closes_at = datetime.now(UTC) - timedelta(hours=1)
    products[0].sale_end = datetime.now(UTC) + timedelta(days=1)
    await db_session.flush()
    parent = authed_client_factory(admin_user)
    access = await parent.post(
        "/shop/delegation/access", json={"token": link.json()["token"], "claim": True}
    )
    assert access.status_code == 410
    saved = await parent.post(
        f"/shop/delegation/products/{products[0].id}",
        json={"token": link.json()["token"], "variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert saved.status_code == 410
    products[0].sale_end = None
    await db_session.flush()
    expired = await parent.post("/shop/delegation/access", json={"token": link.json()["token"]})
    assert expired.status_code == 410


async def test_unified_deadline_notifies_all_products(db_session, deadline_setup):
    _, activity, _, _, products = deadline_setup
    now = datetime.now(UTC)
    activity.order_closes_at = now
    products[1].sale_end = now + timedelta(days=1)
    await db_session.flush()
    assert set(await recently_closed_product_ids(db_session, now=now)) == {
        products[0].id,
        products[1].id,
    }
    products[1].sale_end = None
    products[1].category_id = None
    await db_session.flush()
    assert set(await recently_closed_product_ids(db_session, now=now)) == {
        products[0].id,
        products[1].id,
    }


async def test_assisted_checkout_cannot_extend_past_unified_deadline(db_session, deadline_setup):
    buyer, _, _, _, products = deadline_setup
    product = products[0]
    data = ClassOrderUpsert(
        user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=1)]
    )
    with pytest.raises(ValueError, match="已截止販售"):
        await shop_svc.create_direct_order(db_session, user_id=buyer.id, class_id=None, data=data)
    product.sale_end = datetime.now(UTC) + timedelta(days=1)
    await db_session.flush()
    with pytest.raises(ValueError, match="已截止販售"):
        await shop_svc.create_direct_order(db_session, user_id=buyer.id, class_id=None, data=data)
