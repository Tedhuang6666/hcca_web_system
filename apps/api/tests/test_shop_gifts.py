"""贈票優惠與管理員直接贈送：實際 DB、庫存、權限與零元統計。"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select

from api.core.clock import local_today
from api.models.electronic_credential import ElectronicCredentialSettings
from api.models.outbox import OutboxEvent
from api.models.receivable import Receivable
from api.models.shop import OrderStatus
from api.schemas.school_class import ClassRosterEntryCreate
from api.schemas.shop import ClassOrderUpsert, CurrentRegistrationUpdate, OrderItemCreate
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.shop._analytics import sales_analytics
from api.services.shop._orders import update_order_item_quantity
from tests.test_shop_class import _make_product
from tests.test_shop_router import (
    _bare_user,
    _grant_permission,
    _make_active_product,
    _make_class,
)


@pytest.fixture(autouse=True)
async def student_prefixes(db_session):
    db_session.add(ElectronicCredentialSettings(id=1, student_id_prefixes=["115"]))
    await db_session.flush()


async def test_direct_gift_is_separate_zero_priced_and_counted(db_session, authed_client_factory):
    sc = await _make_class(db_session)
    manager = await _bare_user(db_session, student_id="11501")
    await _grant_permission(db_session, manager, "shop:manage_orders")
    buyer = await _bare_user(db_session, student_id="11520")
    product = await _make_active_product(db_session, manager, price=100, stock=10)
    product.unit_cost = 25
    item = OrderItemCreate(product_id=product.id, quantity=1)
    [paid_order] = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=sc.id,
        data=ClassOrderUpsert(user_id=buyer.id, items=[item]),
    )
    await shop_svc.set_order_paid(db_session, paid_order, is_paid=True, actor_id=manager.id)
    # 已收款、商品截止後仍可發送；贈送不會轉為補收款。
    product.sale_end = datetime.now(UTC) - timedelta(days=1)
    await db_session.flush()
    response = await authed_client_factory(manager).post(
        "/shop/orders/assisted",
        json={
            "user_id": str(buyer.id),
            "collection_mode": "gift",
            "notes": "校慶抽獎中獎",
            "items": [{"product_id": str(product.id), "quantity": 2}],
        },
    )
    assert response.status_code == 201
    gift = response.json()[0]
    assert gift["id"] != str(paid_order.id)
    assert gift["class_id"] == str(sc.id)
    assert gift["supplement_class_id"] is None
    assert gift["assistance_scope"] == "council_gift"
    assert gift["assisted_by_id"] == str(manager.id)
    assert gift["notes"] == "校慶抽獎中獎"
    assert gift["total_price"] == gift["subtotal_price"] == gift["discount_amount"] == 0
    assert gift["items"][0]["unit_price"] == gift["items"][0]["subtotal"] == 0
    assert product.stock_quantity == 7
    assert paid_order.total_price == 100
    assert (await shop_svc.get_current_registration(db_session, buyer.id)).id == paid_order.id
    assert [o.id for o in await shop_svc.get_current_registrations(db_session, buyer.id)] == [
        paid_order.id
    ]
    assert len(await shop_svc.list_orders(db_session, user_id=buyer.id)) == 2
    receivables = list(await db_session.scalars(select(Receivable)))
    assert len(receivables) == 1 and receivables[0].source_id == paid_order.id
    assert not list(await db_session.scalars(select(OutboxEvent)))

    analysis = await sales_analytics(db_session, date_from=local_today(), date_to=local_today())
    assert analysis.current.metrics.item_count == 3
    assert analysis.current.metrics.total_amount == 100
    assert analysis.current.metrics.total_cost == 75
    gift_row = next(row for row in analysis.current.sources if row.key == "council_gift")
    assert gift_row.label == "贈送（免付款）"
    assert gift_row.item_count == 2 and gift_row.total_amount == 0
    assert analysis.current.products[0].item_count == 3


@pytest.mark.parametrize("code", [None, "shop:view_all", "class:shop_collect"])
async def test_direct_gift_requires_manager(db_session, client, authed_client_factory, code):
    sc = await _make_class(db_session)
    actor = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=actor.id)
    if code:
        await _grant_permission(db_session, actor, code)
    buyer = await _bare_user(db_session, student_id="11520")
    product = await _make_active_product(db_session, actor)
    payload = {
        "user_id": str(buyer.id),
        "collection_mode": "gift",
        "notes": "抽獎中獎",
        "items": [{"product_id": str(product.id), "quantity": 1}],
    }
    assert (await client.post("/shop/orders/assisted", json=payload)).status_code == 401
    assert (
        await authed_client_factory(actor).post("/shop/orders/assisted", json=payload)
    ).status_code == 403


async def test_gift_reason_stock_and_edit_protection(db_session, admin_user, authed_client_factory):
    await _make_class(db_session)
    buyer = await _bare_user(db_session, student_id="11520")
    outsider = await _bare_user(db_session, student_id="11521")
    product = await _make_active_product(db_session, admin_user, stock=2)
    ac = authed_client_factory(admin_user)
    payload = {
        "user_id": str(buyer.id),
        "collection_mode": "gift",
        "notes": " ",
        "items": [{"product_id": str(product.id), "quantity": 3}],
    }
    assert (await ac.post("/shop/orders/assisted", json=payload)).status_code == 422
    payload["notes"] = "招待票"
    assert (await ac.post("/shop/orders/assisted", json=payload)).status_code == 422
    # HTTP 422 會 rollback 原交易，重新從資料庫取得商品狀態。
    payload["items"][0]["quantity"] = 2
    response = await ac.post("/shop/orders/assisted", json=payload)
    assert response.status_code == 201
    gift_id = response.json()[0]["id"]
    buyer_client = authed_client_factory(buyer)
    assert (await authed_client_factory(outsider).get(f"/shop/orders/{gift_id}")).status_code in (
        403,
        404,
    )
    assert (
        await ac.patch(f"/shop/orders/{gift_id}/payment", json={"is_paid": True})
    ).status_code == 422
    assert (
        await ac.patch(f"/shop/orders/{gift_id}/collection", json={"is_class_collected": True})
    ).status_code == 422
    gift = await shop_svc.get_order(db_session, UUID(gift_id))
    # 一般登記入口無法將贈送當成可追加的免費購物車。
    assert await shop_svc.get_current_registration(db_session, buyer.id) is None
    assert await shop_svc.get_current_registrations(db_session, buyer.id) == []
    with pytest.raises(ValueError, match="贈送訂單不可修改"):
        await update_order_item_quantity(db_session, gift, gift.items[0].id, quantity=3)
    with pytest.raises(ValueError, match="贈送訂單不可修改"):
        await shop_svc.replace_order_items(
            db_session,
            gift,
            data=ClassOrderUpsert(
                user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=1)]
            ),
        )
    assert (await buyer_client.get(f"/shop/orders/{gift_id}")).json()["total_price"] == 0
    await shop_svc.cancel_order(
        db_session,
        gift,
        requested_by=admin_user.id,
        bypass_owner_check=True,
        bypass_registration_window=True,
    )
    assert gift.status == OrderStatus.CANCELLED
    await db_session.refresh(product)
    assert product.stock_quantity == 2
    assert not list(await db_session.scalars(select(Receivable)))


async def test_targeted_gift_promotion_keeps_quantity_and_zero_revenue(
    db_session, admin_user, authed_client_factory
):
    buyer = await _bare_user(db_session)
    outsider = await _bare_user(db_session)
    product = await _make_active_product(db_session, admin_user, price=100, stock=10)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/shop/promotions",
        json={
            "name": "得獎者贈票",
            "gift_quantity": 2,
            "target_identifiers": [buyer.email],
            "target_product_ids": [str(product.id)],
            "discount_type": "percentage",
            "discount_value": 100,
        },
    )
    assert response.status_code == 201
    buyer_order = await authed_client_factory(buyer).put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert buyer_order.status_code == 200
    assert buyer_order.json()["discount_amount"] == 200
    assert buyer_order.json()["total_price"] == 0
    outsider_order = await authed_client_factory(outsider).put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert outsider_order.status_code == 200
    assert outsider_order.json()["total_price"] == 100
    analysis = await sales_analytics(db_session, date_from=local_today(), date_to=local_today())
    assert analysis.current.metrics.item_count == 3
    assert analysis.current.metrics.total_amount == 100
    assert analysis.current.metrics.discount_amount == 200


@pytest.mark.parametrize("code", [None, "GIFT"])
async def test_gift_recipient_selects_variants_and_pays_only_surcharges(
    db_session, admin_user, authed_client_factory, code
):
    buyer = await _bare_user(db_session)
    outsider = await _bare_user(db_session)
    product = await _make_product(db_session, price=100, stock=10)
    free_options = [str(group.options[0].id) for group in product.variant_groups]
    paid_options = [str(group.options[-1].id) for group in product.variant_groups]
    category_id = str(product.category_id)
    ac = authed_client_factory(admin_user)
    created = await ac.post(
        "/shop/promotions",
        json={
            "name": "中獎紀念衫",
            "gift_quantity": 2,
            "code": code,
            "target_identifiers": [buyer.email],
            "target_product_ids": [str(product.id)],
            "discount_type": "percentage",
            "discount_value": 100,
        },
    )
    assert created.status_code == 201, created.text
    buyer_client = authed_client_factory(buyer)
    path = f"/shop/registrations/current/products/{product.id}"
    selected = await buyer_client.put(
        path, json={"variants": [{"option_ids": paid_options, "quantity": 2}]}
    )
    assert selected.status_code == 200, selected.text
    if code:
        selected = await buyer_client.put(
            "/shop/registrations/current/promotion",
            json={"code": code, "category_id": category_id},
        )
        assert selected.status_code == 200, selected.text
    order = selected.json()
    assert order["subtotal_price"] == 300
    assert order["discount_amount"] == 200
    assert order["total_price"] == 100
    assert {option["option_id"] for option in order["items"][0]["selected_options"]} == set(
        paid_options
    )
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview",
        json={"code": code, "category_id": category_id},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["discount_amount"] == 200
    assert preview.json()["total_price"] == 100

    # 同一位受贈者可更換規格，免加價選項與混合數量均依實際選擇計費。
    for variants, expected in [
        ([{"option_ids": free_options, "quantity": 2}], 0),
        (
            [
                {"option_ids": free_options, "quantity": 1},
                {"option_ids": paid_options, "quantity": 1},
            ],
            50,
        ),
    ]:
        changed = await buyer_client.put(path, json={"variants": variants})
        assert changed.status_code == 200, changed.text
        assert changed.json()["id"] == order["id"]
        assert changed.json()["discount_amount"] == 200
        assert changed.json()["total_price"] == expected
    receivable = await db_session.scalar(
        select(Receivable).where(Receivable.source_id == UUID(order["id"]))
    )
    assert receivable is not None and receivable.amount == 50
    await db_session.refresh(product)
    assert product.stock_quantity == 8

    outsider_client = authed_client_factory(outsider)
    normal = await outsider_client.put(
        path, json={"variants": [{"option_ids": paid_options, "quantity": 1}]}
    )
    assert normal.status_code == 200, normal.text
    assert normal.json()["total_price"] == 150
    if code:
        rejected = await outsider_client.put(
            "/shop/registrations/current/promotion",
            json={"code": code, "category_id": category_id},
        )
        assert rejected.status_code == 422
    assert (await outsider_client.get(f"/shop/orders/{order['id']}")).status_code in (403, 404)


@pytest.mark.parametrize("topic_scoped", [False, True])
@pytest.mark.parametrize("code", [None, "LIMITED_GIFT"])
async def test_gift_limit_allows_paid_extras_and_snapshots_actual_gifts(
    db_session, admin_user, authed_client_factory, topic_scoped, code
):
    buyer = await _bare_user(db_session)
    product = await _make_active_product(db_session, admin_user, price=100, stock=10)
    manager = authed_client_factory(admin_user)
    payload = {
        "name": "限量贈品",
        "code": code,
        "target_identifiers": [buyer.email],
        "target_product_ids": [str(product.id)],
        "discount_type": "percentage",
        "discount_value": 100,
    }
    if topic_scoped:
        payload["target_category_ids"] = []
    created = await manager.post("/shop/promotions", json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["gift_quantity"] == 1
    promotion_id = created.json()["id"]
    buyer_client = authed_client_factory(buyer)
    path = f"/shop/registrations/current/products/{product.id}"
    selected = await buyer_client.put(path, json={"variants": [{"option_ids": [], "quantity": 3}]})
    assert selected.status_code == 200, selected.text
    if code:
        selected = await buyer_client.put(
            "/shop/registrations/current/promotion", json={"code": code}
        )
        assert selected.status_code == 200, selected.text
    order = selected.json()
    assert (order["subtotal_price"], order["discount_amount"], order["total_price"]) == (
        300,
        100,
        200,
    )
    assert order["items"][0]["quantity"] == 3
    assert order["items"][0]["gift_quantity"] == 1
    assert order["items"][0]["gift_discount_amount"] == 100
    public = await buyer_client.get("/shop/promotions/available")
    assert public.status_code == 200, public.text
    assert next(row for row in public.json() if row["id"] == promotion_id)["gift_quantity"] == 1

    for gift_quantity, expected_gifts in [(2, 2), (4, 3)]:
        updated = await manager.patch(
            f"/shop/promotions/{promotion_id}", json={"gift_quantity": gift_quantity}
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["gift_quantity"] == gift_quantity
        if not code:
            repriced = (await buyer_client.get(f"/shop/orders/{order['id']}")).json()
            assert repriced["discount_amount"] == expected_gifts * 100
        selected = await buyer_client.put(
            path, json={"variants": [{"option_ids": [], "quantity": 3}]}
        )
        assert selected.status_code == 200, selected.text
        order = selected.json()
        assert order["discount_amount"] == expected_gifts * 100
        assert order["total_price"] == (3 - expected_gifts) * 100
        assert sum(item["gift_quantity"] for item in order["items"]) == expected_gifts
        preview = await buyer_client.post(
            "/shop/registrations/current/promotion/preview", json={"code": code}
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["total_price"] == order["total_price"]
    unchanged = await manager.patch(f"/shop/promotions/{promotion_id}", json={"name": "更新名稱"})
    assert unchanged.status_code == 200
    assert unchanged.json()["gift_quantity"] == 4
    listed = await buyer_client.get("/shop/orders", params={"my_only": "true"})
    assert listed.status_code == 200
    assert listed.json()[0]["items"][0]["gift_quantity"] == 3
    assert listed.json()[0]["items"][0]["quantity"] == 3
    receivable = await db_session.scalar(
        select(Receivable).where(Receivable.source_id == UUID(order["id"]))
    )
    assert receivable is None or receivable.amount == 0
    await db_session.refresh(product)
    assert product.stock_quantity == 7


@pytest.mark.parametrize("value", [None, 0, 101, 1.5])
async def test_gift_quantity_rejects_invalid_create_and_patch(
    db_session, admin_user, authed_client_factory, value
):
    product = await _make_active_product(db_session, admin_user)
    client = authed_client_factory(admin_user)
    payload = {
        "name": "贈品數量驗證",
        "target_product_ids": [str(product.id)],
        "discount_type": "percentage",
        "discount_value": 100,
    }
    assert (
        await client.post("/shop/promotions", json={**payload, "gift_quantity": value})
    ).status_code == 422
    created = await client.post("/shop/promotions", json=payload)
    assert created.status_code == 201, created.text
    assert (
        await client.patch(
            f"/shop/promotions/{created.json()['id']}", json={"gift_quantity": value}
        )
    ).status_code == 422


async def test_single_gift_limit_is_shared_by_variants_and_kept_after_payment(
    db_session, admin_user, authed_client_factory
):
    buyer = await _bare_user(db_session)
    product = await _make_product(db_session, price=100, stock=10)
    free_options = [str(group.options[0].id) for group in product.variant_groups]
    paid_options = [str(group.options[-1].id) for group in product.variant_groups]
    manager = authed_client_factory(admin_user)
    created = await manager.post(
        "/shop/promotions",
        json={
            "name": "只贈一件紀念衫",
            "target_product_ids": [str(product.id)],
            "target_identifiers": [buyer.email],
            "discount_type": "percentage",
            "discount_value": 100,
        },
    )
    assert created.status_code == 201, created.text
    buyer_client = authed_client_factory(buyer)
    path = f"/shop/registrations/current/products/{product.id}"
    selected = await buyer_client.put(
        path,
        json={
            "variants": [
                {"option_ids": paid_options, "quantity": 2},
                {"option_ids": free_options, "quantity": 1},
            ]
        },
    )
    assert selected.status_code == 200, selected.text
    order = selected.json()
    assert (order["subtotal_price"], order["discount_amount"], order["total_price"]) == (
        400,
        100,
        300,
    )
    assert sum(item["gift_quantity"] for item in order["items"]) == 1
    assert sum(item["gift_discount_amount"] for item in order["items"]) == 100
    assert sum(item["quantity"] for item in order["items"]) == 3
    snapshot = {item["id"]: item["gift_quantity"] for item in order["items"]}
    loaded = await buyer_client.get(f"/shop/orders/{order['id']}")
    assert loaded.status_code == 200
    assert {item["id"]: item["gift_quantity"] for item in loaded.json()["items"]} == snapshot
    paid = await manager.patch(f"/shop/orders/{order['id']}/payment", json={"is_paid": True})
    assert paid.status_code == 200, paid.text
    changed = await manager.patch(
        f"/shop/promotions/{created.json()['id']}", json={"gift_quantity": 3}
    )
    assert changed.status_code == 200, changed.text
    loaded = await buyer_client.get(f"/shop/orders/{order['id']}")
    assert loaded.json()["total_price"] == 300
    assert {item["id"]: item["gift_quantity"] for item in loaded.json()["items"]} == snapshot


async def test_roster_gift_includes_all_variants_and_multiple_products(
    db_session, admin_user, authed_client_factory
):
    sc = await _make_class(db_session)
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=20, student_id="11520")
    )
    shirt = await _make_product(db_session, stock=5)
    ticket = await _make_active_product(db_session, admin_user, stock=3)
    option_ids = [group.options[-1].id for group in shirt.variant_groups]
    response = await authed_client_factory(admin_user).post(
        "/shop/orders/assisted",
        json={
            "roster_entry_id": str(entry.id),
            "collection_mode": "gift",
            "notes": "抽獎組合獎品",
            "items": [
                {
                    "product_id": str(shirt.id),
                    "quantity": 2,
                    "option_ids": [str(x) for x in option_ids],
                },
                {"product_id": str(ticket.id), "quantity": 1},
            ],
        },
    )
    assert response.status_code == 201
    orders = response.json()
    assert len(orders) == 2  # 不同一般商品主題各自成單。
    assert {order["class_id"] for order in orders} == {str(sc.id)}
    assert sum(order["total_price"] for order in orders) == 0
    items = [item for order in orders for item in order["items"]]
    assert sum(item["quantity"] for item in items) == 3
    assert all(item["unit_price"] == item["subtotal"] == 0 for item in items)
    shirt_line = next(item for item in items if item["product_id"] == str(shirt.id))
    assert any(option["price_delta"] > 0 for option in shirt_line["selected_options"])
    assert shirt.stock_quantity == 3 and ticket.stock_quantity == 2
    assert not list(await db_session.scalars(select(Receivable)))
    buyer = (await shop_svc.get_order(db_session, UUID(orders[0]["id"]))).user
    adjusted = await shop_svc.set_class_member_product(
        db_session,
        user=buyer,
        actor=admin_user,
        class_id=sc.id,
        class_ids=[sc.id],
        product_id=shirt.id,
        data=CurrentRegistrationUpdate.model_validate(
            {
                "variants": [{"option_ids": option_ids, "quantity": 3}],
            }
        ),
    )
    gifts = [order for order in adjusted if order.assistance_scope == "council_gift"]
    purchases = [order for order in adjusted if order.assistance_scope != "council_gift"]
    assert len(gifts) == 2 and all(order.total_price == 0 for order in gifts)
    assert sum(item.quantity for order in gifts for item in order.items) == 3
    assert len(purchases) == 1 and purchases[0].total_price == 150
    assert purchases[0].items[0].quantity == 1
