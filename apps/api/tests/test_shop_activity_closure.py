"""活動手動結單：所有訂購入口鎖定，歷史訂單與收款保留。"""

import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.models.audit_log import AuditLog
from api.models.receivable import Receivable
from api.models.school_class import ClassManualMember, SchoolClass
from api.models.shop import Order, Product, ProductCategory
from api.models.shop_class_payment import ShopClassPayment
from api.schemas.shop import (
    CartItemCreate,
    ClassOrderUpsert,
    CurrentRegistrationUpdate,
    OrderItemCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductSeriesCreate,
)
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.shop._deadlines import set_activity_order_closure
from api.services.shop._orders import _assert_activity_open


@pytest.fixture
async def closure_setup(db_session, admin_user, make_user):
    buyer = await make_user(student_id="310001", email="310001@hchs.hc.edu.tw")
    activity = Activity(name="結單測試活動", status=ActivityStatus.ACTIVE)
    other = Activity(name="仍開放活動", status=ActivityStatus.ACTIVE)
    db_session.add_all([activity, other])
    await db_session.flush()
    products = []
    categories = []
    for index, parent in enumerate([activity, activity, other, None]):
        category = await shop_svc.create_category(
            db_session,
            data=ProductCategoryCreate(
                name=f"主題{index}", activity_id=parent.id if parent else None
            ),
            created_by=admin_user.id,
        )
        series = (
            await shop_svc.create_series(
                db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
            )
            if index == 1
            else None
        )
        product = await shop_svc.create_product(
            db_session,
            data=ProductCreate(
                category_id=category.id,
                series_id=series.id if series else None,
                name=f"商品{index}",
                price=100,
                stock_quantity=20,
                sale_end=datetime.now(UTC) + timedelta(days=10),
            ),
            created_by=admin_user.id,
        )
        await shop_svc.activate_product(db_session, product)
        categories.append(category)
        products.append(product)
    return buyer, activity, other, categories, products


async def test_closure_permissions_scope_idempotency_and_audit(
    db_session, client, admin_user, make_user, authed_client_factory, closure_setup
):
    buyer, activity, other, _, _ = closure_setup
    path = f"/shop/activities/{activity.id}/order-closure"
    payload = {"is_closed": True}
    assert (await client.patch(path, json=payload)).status_code == 401
    assert (await authed_client_factory(buyer).patch(path, json=payload)).status_code == 403
    convener = await make_user()
    db_session.add(
        ActivityConvener(activity_id=activity.id, user_id=convener.id, start_date=date.today())
    )
    await db_session.flush()
    manager = authed_client_factory(convener)
    assert (
        await manager.patch(f"/shop/activities/{other.id}/order-closure", json=payload)
    ).status_code == 403
    assert (await manager.patch(path, json={})).status_code == 422
    assert (
        await authed_client_factory(admin_user).patch(
            f"/shop/activities/{uuid.uuid4()}/order-closure", json=payload
        )
    ).status_code == 404
    closed = await manager.patch(path, json=payload)
    assert closed.status_code == 200
    assert closed.json()["order_closed_at"] is not None
    assert closed.json()["status"] == "active"
    assert closed.json()["is_active"] is True
    repeated = await manager.patch(path, json=payload)
    assert repeated.json()["order_closed_at"] == closed.json()["order_closed_at"]
    # 無權限的人也不可重新開放。
    assert (
        await authed_client_factory(buyer).patch(path, json={"is_closed": False})
    ).status_code == 403
    reopened = await authed_client_factory(admin_user).patch(path, json={"is_closed": False})
    assert reopened.status_code == 200
    assert reopened.json()["order_closed_at"] is None
    actions = set(
        await db_session.scalars(
            select(AuditLog.action).where(AuditLog.entity_id == str(activity.id))
        )
    )
    assert {"shop.activity_order_close", "shop.activity_order_reopen"} <= actions


async def test_closed_activity_hidden_from_catalog_but_available_for_collection(
    db_session, client, admin_user, authed_client_factory, closure_setup
):
    _, activity, _, categories, products = closure_setup
    # 舊資料的系列商品也要跟隨活動結單。
    products[1].category_id = None
    manager = authed_client_factory(admin_user)
    await manager.patch(f"/shop/activities/{activity.id}/order-closure", json={"is_closed": True})
    catalog = (await client.get("/shop/catalog")).json()
    assert {row["id"] for row in catalog} == {str(row.id) for row in categories[2:]}
    assert (await client.get(f"/shop/catalog?activity_id={activity.id}")).json() == []
    assert (await client.get("/shop/catalog?include_closed=true")).status_code == 401
    retained = await manager.get("/shop/catalog?include_closed=true")
    assert retained.status_code == 200
    assert len(retained.json()) == 4
    assert (
        next(row for row in retained.json() if row["id"] == str(categories[0].id))[
            "order_closed_at"
        ]
        is not None
    )
    await manager.patch(f"/shop/activities/{activity.id}/order-closure", json={"is_closed": False})
    assert len((await client.get("/shop/catalog")).json()) == 4


async def test_globally_closed_category_is_hidden_from_public_catalog_and_restored_on_reopen(
    client, admin_user, authed_client_factory, closure_setup
):
    _, _, _, categories, _ = closure_setup
    manager = authed_client_factory(admin_user)
    category_id = categories[0].id

    closed = await manager.post(f"/shop/categories/{category_id}/close", json={})
    assert closed.status_code == 201
    assert str(category_id) not in {row["id"] for row in (await client.get("/shop/catalog")).json()}

    direct_link = await client.get("/shop/catalog", params={"direct_path": "商品0"})
    assert direct_link.status_code == 200
    direct_category = direct_link.json()[0]
    assert direct_category["id"] == str(category_id)
    assert [product["name"] for product in direct_category["products"]] == ["商品0"]

    retained = await manager.get("/shop/catalog?include_closed=true")
    closed_category = next(row for row in retained.json() if row["id"] == str(category_id))
    assert closed_category["order_closed_at"] is not None

    reopened = await manager.delete(f"/shop/categories/{category_id}/close")
    assert reopened.status_code == 200
    assert str(category_id) in {row["id"] for row in (await client.get("/shop/catalog")).json()}


@pytest.mark.parametrize(
    ("is_admin", "explicit_class", "expected_resolutions"),
    [(True, True, 0), (True, False, 1), (False, True, 1)],
)
async def test_close_status_resolves_own_class_only_when_needed(
    db_session,
    admin_user,
    authed_client_factory,
    closure_setup,
    monkeypatch,
    is_admin,
    explicit_class,
    expected_resolutions,
):
    buyer, _, _, categories, _ = closure_setup
    school_class = SchoolClass(academic_year=116, class_code="101", created_by=admin_user.id)
    db_session.add(school_class)
    await db_session.flush()
    db_session.add(ClassManualMember(class_id=school_class.id, user_id=buyer.id))
    await db_session.flush()
    resolver = AsyncMock(wraps=class_svc.resolve_user_class)
    monkeypatch.setattr(class_svc, "resolve_user_class", resolver)
    params = {"category_ids": str(categories[0].id)}
    if explicit_class:
        params["class_id"] = str(school_class.id)

    response = await authed_client_factory(admin_user if is_admin else buyer).get(
        "/shop/close-status", params=params
    )

    assert response.status_code == 200
    assert response.json()["statuses"][str(categories[0].id)]["is_closed"] is False
    assert resolver.await_count == expected_resolutions


async def test_close_status_includes_class_collection_and_council_confirmation_times(
    db_session, admin_user, authed_client_factory, client, make_user, closure_setup
):
    buyer, activity, _, categories, _ = closure_setup
    school_class = SchoolClass(
        academic_year=116,
        class_code=f"{uuid.uuid4().hex[:6]}",
        grade=1,
        created_by=buyer.id,
    )
    db_session.add(school_class)
    await db_session.flush()
    db_session.add(ClassManualMember(class_id=school_class.id, user_id=buyer.id))
    await db_session.flush()

    earlier_collection = datetime(2026, 10, 20, 10, tzinfo=UTC)
    latest_collection = datetime(2026, 10, 21, 10, tzinfo=UTC)
    council_confirmation = datetime(2026, 10, 22, 10, tzinfo=UTC)
    db_session.add_all(
        [
            Order(
                serial_number=f"ORD-TEST-{uuid.uuid4().hex[:8]}",
                user_id=buyer.id,
                activity_id=activity.id,
                category_id=categories[0].id,
                class_id=school_class.id,
                is_class_collected=True,
                class_collected_at=earlier_collection,
            ),
            Order(
                serial_number=f"ORD-TEST-{uuid.uuid4().hex[:8]}",
                user_id=buyer.id,
                activity_id=activity.id,
                category_id=categories[1].id,
                class_id=school_class.id,
                is_class_collected=True,
                class_collected_at=latest_collection,
            ),
            ShopClassPayment(
                class_id=school_class.id,
                activity_id=activity.id,
                is_paid=True,
                confirmed_at=council_confirmation,
                confirmed_by_id=admin_user.id,
            ),
        ]
    )
    await db_session.flush()

    endpoint = f"/shop/close-status?category_ids={categories[0].id}&class_id={school_class.id}"
    assert (await client.get(endpoint)).status_code == 401

    response = await authed_client_factory(admin_user).get(endpoint)
    assert response.status_code == 200
    status_item = response.json()["statuses"][str(categories[0].id)]
    assert datetime.fromisoformat(status_item["class_collected_at"]) == latest_collection
    assert datetime.fromisoformat(status_item["council_confirmed_at"]) == council_confirmation

    member_status = await authed_client_factory(buyer).get(endpoint)
    assert member_status.status_code == 200
    assert (
        datetime.fromisoformat(
            member_status.json()["statuses"][str(categories[0].id)]["class_collected_at"]
        )
        == latest_collection
    )

    outsider = await make_user(student_id="310002", email="310002@hchs.hc.edu.tw")
    outsider_status = await authed_client_factory(outsider).get(endpoint)
    outsider_item = outsider_status.json()["statuses"][str(categories[0].id)]
    assert outsider_status.status_code == 200
    assert outsider_item["class_collected_at"] is None
    assert outsider_item["council_confirmed_at"] is None


async def test_closed_activity_locks_registration_cancel_promotion_and_preserves_orders(
    db_session, admin_user, authed_client_factory, closure_setup
):
    buyer, activity, _, _, products = closure_setup
    ac = authed_client_factory(buyer)
    manager = authed_client_factory(admin_user)
    for product in products[:2]:
        response = await ac.put(
            f"/shop/registrations/current/products/{product.id}",
            json={"variants": [{"option_ids": [], "quantity": 1}]},
        )
        assert response.status_code == 200
    order = response.json()
    await manager.patch(f"/shop/activities/{activity.id}/order-closure", json={"is_closed": True})
    for product in products[:2]:
        for variants in [[], [{"option_ids": [], "quantity": 2}]]:
            blocked = await ac.put(
                f"/shop/registrations/current/products/{product.id}", json={"variants": variants}
            )
            assert blocked.status_code == 409
            assert "活動已結單" in blocked.json()["detail"]
    cancel = await ac.post(f"/shop/orders/{order['id']}/cancel", json={})
    assert cancel.status_code == 409
    promotion = await ac.put(
        "/shop/registrations/current/promotion",
        json={"activity_id": str(activity.id), "code": None},
    )
    assert promotion.status_code == 422
    assert "活動已結單" in promotion.json()["detail"]
    history = (await ac.get("/shop/orders?my_only=true")).json()
    assert len(history) == 1
    assert history[0]["id"] == order["id"]
    assert history[0]["total_price"] == 200
    assert sum(item["quantity"] for item in history[0]["items"]) == 2
    assert products[0].stock_quantity == products[1].stock_quantity == 19
    for product in products[2:]:
        assert (
            await ac.put(
                f"/shop/registrations/current/products/{product.id}",
                json={"variants": [{"option_ids": [], "quantity": 1}]},
            )
        ).status_code == 200
    await manager.patch(f"/shop/activities/{activity.id}/order-closure", json={"is_closed": False})
    assert (
        await ac.put(
            f"/shop/registrations/current/products/{products[0].id}",
            json={"variants": [{"option_ids": [], "quantity": 2}]},
        )
    ).status_code == 200


@pytest.mark.parametrize("collection_flag", [None, "is_paid", "is_class_collected"])
async def test_closed_activity_manager_cancellation_preserves_collection_lock(
    db_session, admin_user, authed_client_factory, closure_setup, collection_flag
):
    buyer, activity, _, _, products = closure_setup
    product = products[0]
    buyer_client = authed_client_factory(buyer)
    response = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"quantity": 1}]},
    )
    assert response.status_code == 200
    order_id = uuid.UUID(response.json()["id"])
    order = await db_session.get(Order, order_id)
    if collection_flag:
        setattr(order, collection_flag, True)
        await db_session.flush()
    manager = authed_client_factory(admin_user)
    closed = await manager.patch(
        f"/shop/activities/{activity.id}/order-closure", json={"is_closed": True}
    )
    assert closed.status_code == 200
    path = f"/shop/orders/{order_id}/cancel"
    assert (await buyer_client.post(path, json={})).status_code == 409
    cancelled = await manager.post(path, json={"reason": "逾期未繳"})
    await db_session.refresh(product)
    await db_session.refresh(order)
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order_id))
    if collection_flag:
        assert cancelled.status_code == 409
        assert "已鎖定" in cancelled.json()["detail"]
        assert order.status == "pending"
        assert product.stock_quantity == 19
        assert receivable.status != "canceled"
        return

    assert cancelled.status_code == 200, cancelled.text
    assert order.status == "cancelled"
    assert "逾期未繳" in order.notes
    assert product.stock_quantity == 20
    assert receivable.status == "canceled"
    audit = await db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "shop.order_cancel", AuditLog.entity_id == str(order_id)
        )
    )
    assert audit is not None and audit.actor_id == str(admin_user.id)
    assert (await manager.post(path, json={})).status_code == 409
    await db_session.refresh(product)
    assert product.stock_quantity == 20


async def test_closed_activity_blocks_assisted_checkout_and_existing_cart(
    db_session, admin_user, authed_client_factory, closure_setup
):
    buyer, activity, _, _, products = closure_setup
    product = products[0]
    await shop_svc.add_cart_item(
        db_session, buyer.id, data=CartItemCreate(product_id=product.id, quantity=1)
    )
    await authed_client_factory(admin_user).patch(
        f"/shop/activities/{activity.id}/order-closure", json={"is_closed": True}
    )
    cart = await shop_svc.get_or_create_cart(db_session, buyer.id)
    assert shop_svc.serialize_cart(cart).items[0].available is False
    with pytest.raises(ValueError, match="活動已結單"):
        await shop_svc.checkout(db_session, buyer)
    class_id = uuid.uuid4()
    with pytest.raises(ValueError, match="活動已結單"):
        await shop_svc.set_class_member_product(
            db_session,
            user=buyer,
            actor=admin_user,
            class_id=class_id,
            class_ids=[class_id],
            product_id=product.id,
            data=CurrentRegistrationUpdate(variants=[]),
        )
    with pytest.raises(ValueError, match="活動已結單"):
        await shop_svc.create_direct_order(
            db_session,
            user_id=buyer.id,
            class_id=None,
            data=ClassOrderUpsert(
                user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=1)]
            ),
        )


async def test_closed_activity_keeps_collection_and_payment_working(
    admin_user, authed_client_factory, closure_setup
):
    buyer, activity, _, _, products = closure_setup
    ac = authed_client_factory(buyer)
    saved = await ac.put(
        f"/shop/registrations/current/products/{products[0].id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    order_id = saved.json()["id"]
    manager = authed_client_factory(admin_user)
    await manager.patch(f"/shop/activities/{activity.id}/order-closure", json={"is_closed": True})
    collected = await manager.patch(
        f"/shop/orders/{order_id}/collection", json={"is_class_collected": True}
    )
    assert collected.status_code == 200
    assert collected.json()["is_class_collected"] is True
    paid = await manager.patch(f"/shop/orders/{order_id}/payment", json={"is_paid": True})
    assert paid.status_code == 200
    assert paid.json()["is_paid"] is True
    retained = await ac.get(f"/shop/orders/{order_id}")
    assert retained.status_code == 200
    assert retained.json()["total_price"] == 100
    assert retained.json()["activity_id"] == str(activity.id)


async def test_closed_activity_disables_delegation_even_with_extended_product(
    admin_user, authed_client_factory, closure_setup
):
    buyer, activity, _, categories, _ = closure_setup
    link = await authed_client_factory(buyer).post(
        "/shop/delegation-links", json={"name": "家人", "category_id": str(categories[0].id)}
    )
    assert link.status_code == 201
    manager = authed_client_factory(admin_user)
    await manager.patch(f"/shop/activities/{activity.id}/order-closure", json={"is_closed": True})
    access = await manager.post("/shop/delegation/access", json={"token": link.json()["token"]})
    assert access.status_code == 410


async def test_deadline_changes_cannot_reopen_and_reopening_preserves_deadline(
    db_session, admin_user, authed_client_factory, closure_setup
):
    buyer, activity, _, _, products = closure_setup
    manager = authed_client_factory(admin_user)
    path = f"/shop/activities/{activity.id}"
    await manager.patch(f"{path}/order-closure", json={"is_closed": True})
    deadline = await manager.patch(f"{path}/order-deadline", json={"order_closes_at": None})
    assert deadline.json()["order_closed_at"] is not None
    ac = authed_client_factory(buyer)
    register = f"/shop/registrations/current/products/{products[0].id}"
    payload = {"variants": [{"option_ids": [], "quantity": 1}]}
    assert (await ac.put(register, json=payload)).status_code == 409
    activity.order_closes_at = datetime.now(UTC) - timedelta(hours=1)
    products[0].sale_end = None
    await db_session.flush()
    reopened = await manager.patch(f"{path}/order-closure", json={"is_closed": False})
    assert reopened.json()["order_closes_at"] is not None
    blocked = await ac.put(register, json=payload)
    assert blocked.status_code == 409
    assert "已截止登記" in blocked.json()["detail"]


async def test_concurrent_closure_waits_and_refreshes_cached_activity(db_session):
    """已持有舊活動物件的訂購交易，必須等待結單並讀到新狀態。"""
    if db_session.get_bind().dialect.name != "postgresql":
        pytest.skip("需要 PostgreSQL 的跨交易列鎖")
    factory = async_sessionmaker(db_session.bind.engine, expire_on_commit=False)
    async with factory() as setup:
        activity = Activity(name="並行結單測試", status=ActivityStatus.ACTIVE)
        setup.add(activity)
        await setup.commit()
        activity_id = activity.id
    try:
        async with factory() as reader, factory() as writer:
            cached = await reader.get(Activity, activity_id)
            assert cached.order_closed_at is None
            product = Product(name="並行商品", category=ProductCategory(activity_id=activity_id))
            await set_activity_order_closure(writer, activity_id, is_closed=True)
            check = asyncio.create_task(_assert_activity_open(reader, product))
            try:
                done, _ = await asyncio.wait({check}, timeout=0.1)
                assert not done, "訂購檢查應等待尚未提交的結單交易"
                await writer.commit()
                with pytest.raises(ValueError, match="活動已結單"):
                    await asyncio.wait_for(check, timeout=3)
                assert cached.order_closed_at is not None
            finally:
                check.cancel()
                await asyncio.gather(check, return_exceptions=True)
    finally:
        async with factory() as cleanup:
            await cleanup.delete(await cleanup.get(Activity, activity_id))
            await cleanup.commit()
