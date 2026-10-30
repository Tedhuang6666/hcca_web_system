"""商品訂購系統 Router 層測試 - 涵蓋 HTTP 端點的權限與流程分支。

test_shop_class.py 已涵蓋服務層（班級歸戶／變體計價／結單）；本檔補齊 HTTP 層
（router 權限檢查、404/403/409 分支、報表匯出、結單權限矩陣）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.models.electronic_credential import ElectronicCredentialSettings
from api.models.org import Org, Permission, Position, UserPosition
from api.models.outbox import OutboxEvent
from api.models.person import Person, PersonAffiliationKind
from api.models.receivable import Receivable, ReceivableSource
from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ShopDelegationLink,
)
from api.models.user import User
from api.schemas.person import PersonAffiliationCreate
from api.schemas.school_class import (
    ClassManualMemberCreate,
    ClassRoleAssign,
    ClassRosterEntryCreate,
    ClassStudentRangeCreate,
    SchoolClassCreate,
)
from api.schemas.shop import (
    ClassOrderUpsert,
    OrderItemCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductSeriesCreate,
    ProductVariantGroupCreate,
    ProductVariantOptionCreate,
)
from api.services import person as person_svc
from api.services import school_class as class_svc
from api.services import shop as shop_svc

_PNG_BYTES = b"\x89PNG\r\n\x1a\n data"


@pytest.mark.parametrize("collection", ["regular", "class_paid", "collected", "council_separate"])
async def test_assisted_individual_payment_notices_target_buyer(
    db_session, client, authed_client_factory, monkeypatch, collection
):
    from api.services.outbox import _dispatch

    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session, student_id="11520")
    outsider = await _bare_user(db_session, student_id="11620")
    product = await _make_active_product(db_session, cadre, price=45)
    actor = authed_client_factory(cadre)
    if collection == "class_paid":
        from api.models.shop_class_payment import ShopClassPayment

        db_session.add(ShopClassPayment(class_id=sc.id, activity_id=None, is_paid=True))
    elif collection == "collected":
        await _seed_order(db_session, buyer, class_id=sc.id, is_class_collected=True)
    elif collection == "council_separate":
        await _grant_permission(db_session, cadre, "shop:manage_orders")
    await db_session.flush()

    path = "/shop/orders/assisted" if collection == "council_separate" else "/shop/orders/class"
    payload = {"user_id": str(buyer.id), "items": [{"product_id": str(product.id), "quantity": 2}]}
    if collection == "council_separate":
        payload["collection_mode"] = "separate"
    assert (await client.post(path, json=payload)).status_code == 401
    assert (await authed_client_factory(outsider).post(path, json=payload)).status_code == 403
    assert (await authed_client_factory(buyer).post(path, json=payload)).status_code == 403
    assert not list(
        await db_session.scalars(
            select(OutboxEvent).where(OutboxEvent.event_type == "shop.order_payment_required")
        )
    )

    response = await actor.post(path, json=payload)
    assert response.status_code == 201, response.text
    order = response.json()[0]
    notices = list(
        await db_session.scalars(
            select(OutboxEvent).where(OutboxEvent.event_type == "shop.order_payment_required")
        )
    )
    if collection == "regular":
        assert order["class_id"] == str(sc.id)
        assert notices == []
        return
    assert order["class_id"] is None
    assert len(notices) == 1
    assert notices[0].payload["order_id"] == order["id"]
    assert notices[0].payload["buyer_email"] == buyer.email
    assert notices[0].payload["reason"] == "supplement_created"
    assert notices[0].payload["total_price"] == 90
    messages = []
    monkeypatch.setattr("api.services.mail.enqueue_email", lambda *args: messages.append(args))
    await _dispatch(db_session, notices[0])
    assert len(messages) == 1 and messages[0][0] == buyer.email
    assert "需額外繳費" in messages[0][2]
    assert "班聯會公告的繳費期限" in messages[0][2]
    assert "逾期未繳，班聯會將取消您的訂單" in messages[0][2]
    # 清除訂購資料也必須清掉待寄信件，避免寄出已不存在訂單的催款通知。
    assert await shop_svc.clear_all_orders(db_session) >= 1
    assert not list(
        await db_session.scalars(
            select(OutboxEvent).where(OutboxEvent.event_type == "shop.order_payment_required")
        )
    )


@pytest.mark.parametrize("total_price", [0, 123])
async def test_separating_order_notifies_once_with_existing_payment_deadline(
    db_session, client, authed_client_factory, monkeypatch, total_price
):
    from api.services import receivable as receivable_svc
    from api.services.outbox import _dispatch

    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session, student_id="11520")
    other_class = await _make_class(db_session, start="11601", end="11640")
    other_cadre = await _bare_user(db_session, student_id="11601")
    await class_svc.add_cadre(db_session, other_class, user_id=other_cadre.id)
    order = await _seed_order(db_session, buyer, class_id=sc.id, total_price=total_price)
    receivable = await receivable_svc.sync_shop_order(db_session, order)
    receivable.due_at = datetime(2026, 11, 5, 8, 30, tzinfo=UTC)
    await db_session.flush()
    path = f"/shop/orders/{order.id}/separate"
    assert (await client.post(path)).status_code == 401
    assert (await authed_client_factory(buyer).post(path)).status_code == 403
    assert (await authed_client_factory(other_cadre).post(path)).status_code == 403
    assert not list(
        await db_session.scalars(
            select(OutboxEvent).where(OutboxEvent.event_type == "shop.order_payment_required")
        )
    )
    actor = authed_client_factory(cadre)
    for _ in range(2):
        response = await actor.post(path)
        assert response.status_code == 200, response.text
    notices = list(
        await db_session.scalars(
            select(OutboxEvent).where(OutboxEvent.event_type == "shop.order_payment_required")
        )
    )
    if total_price == 0:
        assert notices == []
        return
    assert len(notices) == 1
    assert notices[0].payload["buyer_email"] == buyer.email
    assert notices[0].payload["order_id"] == str(order.id)
    assert notices[0].payload["reason"] == "separated_from_class"
    assert notices[0].payload["payment_deadline"] == "2026/11/05 16:30（台北時間）"
    messages = []
    monkeypatch.setattr("api.services.mail.enqueue_email", lambda *args: messages.append(args))
    await _dispatch(db_session, notices[0])
    assert len(messages) == 1 and messages[0][0] == buyer.email
    body = messages[0][2]
    assert "移出班級統一收款" in body
    assert "NT$ 123" in body
    assert "2026/11/05 16:30（台北時間）" in body
    assert "逾期未繳，班聯會將取消您的訂單" in body
    assert "/shop/orders" in body


async def test_individual_payment_notice_rolls_back_with_order_change(db_session):
    from api.services.shop._supplements import separate_order

    sc = await _make_class(db_session)
    buyer = await _bare_user(db_session, student_id="11520")
    order = await _seed_order(db_session, buyer, class_id=sc.id)
    order_id, class_id, buyer_id = order.id, sc.id, buyer.id
    async with db_session.begin_nested() as transaction:
        await separate_order(db_session, order, actor_id=buyer_id)
        assert (
            await db_session.scalar(
                select(func.count())
                .select_from(OutboxEvent)
                .where(OutboxEvent.event_type == "shop.order_payment_required")
            )
            == 1
        )
        await transaction.rollback()
    await db_session.refresh(order)
    assert order.id == order_id and order.class_id == class_id
    assert not list(
        await db_session.scalars(
            select(OutboxEvent).where(OutboxEvent.event_type == "shop.order_payment_required")
        )
    )


@pytest.mark.parametrize("code", ["shop:manage", "shop:manage_orders", "admin:all"])
async def test_admin_assisted_order_across_classes(db_session, authed_client_factory, code):
    own_class = await _make_class(db_session)
    other_class = await _make_class(db_session, start="11601", end="11640")
    manager = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, own_class, user_id=manager.id)
    await _grant_permission(db_session, manager, code)
    student = await _bare_user(db_session, student_id="11620")
    product = await _make_active_product(db_session, manager, price=50)
    ac = authed_client_factory(manager)
    recipients = await ac.get(f"/shop/orders/recipients/{other_class.id}")
    assert recipients.status_code == 200
    assert student.id.hex in {uuid.UUID(row["user_id"]).hex for row in recipients.json()}
    payload = {
        "user_id": str(student.id),
        "items": [{"product_id": str(product.id), "quantity": 2}],
        "notes": "班聯協助",
    }
    assert (await ac.post("/shop/orders/class", json=payload)).status_code == 403
    response = await ac.post("/shop/orders/assisted", json=payload)
    assert response.status_code == 201
    order = response.json()[0]
    assert order["user_id"] == str(student.id)
    assert order["class_id"] == str(other_class.id)
    assert order["assisted_by_id"] == str(manager.id)
    assert order["total_price"] == 100
    assert order["notes"] == "班聯協助"
    assert not order["is_paid"]


async def test_admin_assisted_roster_student_before_login(db_session, authed_client_factory):
    sc = await _make_class(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=20, student_id="11520")
    )
    product = await _make_active_product(db_session, manager, price=25)
    ac = authed_client_factory(manager)
    members = (await ac.get(f"/shop/orders/recipients/{sc.id}")).json()
    assert members[0]["user_id"] is None
    assert members[0]["roster_entry_id"] == str(entry.id)
    response = await ac.post(
        "/shop/orders/assisted",
        json={
            "roster_entry_id": str(entry.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert response.status_code == 201
    order = response.json()[0]
    assert order["class_id"] == str(sc.id)
    assert order["assisted_by_id"] == str(manager.id)
    linked_user = await db_session.get(User, uuid.UUID(order["user_id"]))
    assert linked_user.student_id == "11520"


@pytest.mark.parametrize("code", [None, "shop:view_all", "class:shop_collect"])
async def test_admin_assisted_endpoints_deny_non_managers(
    db_session, client, authed_client_factory, code
):
    sc = await _make_class(db_session)
    actor = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=actor.id)
    if code:
        await _grant_permission(db_session, actor, code)
    student = await _bare_user(db_session, student_id="11520")
    product = await _make_active_product(db_session, actor)
    payload = {
        "user_id": str(student.id),
        "items": [{"product_id": str(product.id), "quantity": 1}],
    }
    assert (await client.get(f"/shop/orders/recipients/{sc.id}")).status_code == 401
    assert (await client.post("/shop/orders/assisted", json=payload)).status_code == 401
    ac = authed_client_factory(actor)
    assert (await ac.get(f"/shop/orders/recipients/{sc.id}")).status_code == 403
    assert (await ac.post("/shop/orders/assisted", json=payload)).status_code == 403


async def test_admin_assisted_order_rejects_inactive_and_unassigned_students(
    db_session, admin_user, authed_client_factory
):
    await _make_class(db_session)
    student = await _bare_user(db_session, student_id="11520")
    student.is_active = False
    unassigned = await _bare_user(db_session)
    product = await _make_active_product(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    for target in (student, unassigned):
        response = await ac.post(
            "/shop/orders/assisted",
            json={
                "user_id": str(target.id),
                "items": [{"product_id": str(product.id), "quantity": 1}],
            },
        )
        assert response.status_code == 403
    assert (await ac.get(f"/shop/orders/recipients/{uuid.uuid4()}")).status_code == 404


@pytest.mark.parametrize("constraint", ["stock", "deadline", "global_close", "purchase_limit"])
async def test_admin_assisted_order_keeps_order_constraints(
    db_session, admin_user, authed_client_factory, constraint
):
    await _make_class(db_session)
    student = await _bare_user(db_session, student_id="11520")
    product = await _make_active_product(db_session, admin_user, stock=1)
    ac = authed_client_factory(admin_user)
    if constraint == "deadline":
        product.sale_end = datetime.now(UTC) - timedelta(minutes=1)
        await db_session.flush()
    elif constraint == "global_close":
        closed = await ac.post(f"/shop/categories/{product.category_id}/close", json={})
        assert closed.status_code == 201
    elif constraint == "purchase_limit":
        product.max_quantity_per_user = 1
        product.stock_quantity = 10
        await db_session.flush()
    response = await ac.post(
        "/shop/orders/assisted",
        json={
            "user_id": str(student.id),
            "items": [
                {
                    "product_id": str(product.id),
                    "quantity": 2 if constraint in {"stock", "purchase_limit"} else 1,
                }
            ],
        },
    )
    assert response.status_code == (422 if constraint == "stock" else 201)
    if constraint == "global_close":
        assert response.json()[0]["class_id"] is None
        assert response.json()[0]["supplement_class_id"] is not None
    assert await db_session.scalar(select(func.count()).select_from(Order)) == (
        0 if constraint == "stock" else 1
    )


@pytest.fixture(autouse=True)
async def current_shop_student_prefixes(db_session):
    db_session.add(
        ElectronicCredentialSettings(
            id=1, student_id_prefixes=["115", "116", "215", "310", "410", "510"]
        )
    )
    await db_session.flush()


@pytest.mark.parametrize("council_closed", [False, True])
async def test_supplement_collection_rejoins_original_class_and_has_own_receipt(
    db_session, authed_client_factory, client, council_closed
):
    from io import BytesIO

    from pypdf import PdfReader

    sc = await _make_class(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session, student_id="11520")
    outsider = await _bare_user(db_session, student_id="11620")
    product = await _make_active_product(db_session, manager, price=17)
    mc, cc, bc = [authed_client_factory(user) for user in (manager, cadre, buyer)]
    original = await bc.put(
        f"/shop/registrations/current/products/{product.id}", json={"variants": [{"quantity": 1}]}
    )
    assert original.status_code == 200
    original_id = original.json()["id"]
    paid = await mc.patch(
        f"/shop/orders/classes/{sc.id}/payment", json={"is_paid": True, "activity_id": None}
    )
    assert paid.status_code == 200
    assert (
        await bc.put(
            f"/shop/registrations/current/products/{product.id}",
            json={"variants": [{"quantity": 2}]},
        )
    ).status_code == 409
    payload = {"user_id": str(buyer.id), "items": [{"product_id": str(product.id), "quantity": 2}]}
    if council_closed:
        assert (
            await mc.post(f"/shop/categories/{product.category_id}/close", json={})
        ).status_code == 201
        assert (await cc.post("/shop/orders/class", json=payload)).status_code == 422
        added = await mc.post("/shop/orders/assisted", json=payload)
        actor = mc
    else:
        added = await cc.post("/shop/orders/class", json=payload)
        actor = cc
    assert added.status_code == 201, added.text
    supplement = added.json()[0]
    sid = supplement["id"]
    assert supplement["class_id"] is None
    assert supplement["supplement_class_id"] == str(sc.id)
    assert supplement["total_price"] == 34
    assert not supplement["is_paid"]
    assert (await client.get("/shop/orders/supplements")).status_code == 401
    assert (await authed_client_factory(outsider).get("/shop/orders/supplements")).json() == []
    assert (await actor.get("/shop/orders/supplements")).json()[0]["id"] == sid
    unpaid_receipt = await actor.get(f"/shop/orders/{sid}/supplement-receipt.pdf")
    assert unpaid_receipt.status_code == 200
    unpaid_text = "".join(
        page.extract_text() for page in PdfReader(BytesIO(unpaid_receipt.content)).pages
    )
    assert "補收款" in unpaid_text and "34" in unpaid_text
    unpaid_order = (await bc.get(f"/shop/orders/{sid}")).json()
    assert unpaid_order["is_paid"] is False
    assert unpaid_order["class_id"] is None
    assert unpaid_order["supplement_class_id"] == str(sc.id)
    assert (await client.get(f"/shop/orders/{sid}/supplement-receipt.pdf")).status_code == 401
    assert (
        await authed_client_factory(outsider).get(f"/shop/orders/{sid}/supplement-receipt.pdf")
    ).status_code == 404
    # 班級查詢的補歸班不能把待補收訂單提前併回。
    assert {
        str(order.id) for order in await shop_svc.list_orders(db_session, class_ids=[sc.id])
    } == {original_id}
    assert {
        str(order.id)
        for order in await shop_svc.get_class_member_registrations(db_session, buyer.id, [sc.id])
    } == {original_id}
    assert all(
        str(order.id) != sid
        for order in await shop_svc.get_current_registrations(db_session, buyer.id)
    )
    assert (
        await authed_client_factory(outsider).patch(
            f"/shop/orders/{sid}/payment", json={"is_paid": True}
        )
    ).status_code in {403, 404}
    confirmed = await mc.patch(f"/shop/orders/{sid}/payment", json={"is_paid": True})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["class_id"] == str(sc.id)
    receipt = await actor.get(f"/shop/orders/{sid}/supplement-receipt.pdf")
    assert receipt.status_code == 200
    text = "".join(page.extract_text() for page in PdfReader(BytesIO(receipt.content)).pages)
    assert "補收款" in text and "34" in text
    assert _receipt_totals(PdfReader(BytesIO(receipt.content))) == ["34", "34"]
    report = await mc.get("/shop/orders/class-payments")
    report_rows = report.json()
    assert sum(row["amount"] for row in report_rows) == 51
    assert [row["collection_type"] for row in report_rows] == ["class", "individual_order"]
    class_payment = next(row for row in report_rows if row["collection_type"] == "class")
    individual_payment = next(
        row for row in report_rows if row["collection_type"] == "individual_order"
    )
    assert class_payment["amount"] == 17
    assert class_payment["order_count"] == 1
    assert individual_payment["record_id"] == sid
    assert individual_payment["amount"] == 34
    assert individual_payment["order_count"] == 1
    assert individual_payment["confirmed_at"] == confirmed.json()["paid_at"]
    original_after = (await bc.get(f"/shop/orders/{original_id}")).json()
    assert original_after["is_paid"] and original_after["total_price"] == 17
    receivable = await db_session.scalar(
        select(Receivable).where(Receivable.source_id == uuid.UUID(sid))
    )
    assert receivable.class_id == sc.id and receivable.paid_amount == 34
    reversed_payment = await mc.patch(f"/shop/orders/{sid}/payment", json={"is_paid": False})
    assert reversed_payment.json()["class_id"] is None
    assert (await actor.get(f"/shop/orders/{sid}/supplement-receipt.pdf")).status_code == 200


async def test_class_deadline_is_scoped_and_assisted_orders_can_bypass_it(
    db_session, authed_client_factory
):
    sc = await _make_class(db_session)
    other = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session, student_id="11520")
    product = await _make_active_product(db_session, cadre)
    cc, bc = authed_client_factory(cadre), authed_client_factory(buyer)
    path = f"/shop/categories/{product.category_id}/close"
    expired = {
        "class_id": str(sc.id),
        "closes_at": (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
    }
    assert (await bc.post(path, json=expired)).status_code == 403
    assert (await cc.post(path, json={**expired, "class_id": str(other.id)})).status_code == 403
    assert (await cc.post(path, json=expired)).status_code == 201
    assert (
        await bc.put(
            f"/shop/registrations/current/products/{product.id}",
            json={"variants": [{"quantity": 1}]},
        )
    ).status_code == 409
    payload = {"user_id": str(buyer.id), "items": [{"product_id": str(product.id), "quantity": 1}]}
    assert (await cc.post("/shop/orders/class", json=payload)).status_code == 201
    future = {**expired, "closes_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()}
    assert (await cc.post(path, json=future)).status_code == 201
    loaded = await cc.get(
        f"/shop/categories/{product.category_id}/class-deadline", params={"class_id": str(sc.id)}
    )
    assert loaded.json()["closes_at"] == future["closes_at"].replace("+00:00", "Z")
    assert (
        await bc.put(
            f"/shop/registrations/current/products/{product.id}",
            json={"variants": [{"quantity": 2}]},
        )
    ).status_code == 200
    assert (await cc.delete(path, params={"class_id": str(sc.id)})).status_code == 200
    assert (await cc.post(path, json={})).status_code == 403


@pytest.mark.parametrize("manager", [False, True])
async def test_manually_separate_order_checks_class_scope_and_preserves_amounts(
    db_session, client, authed_client_factory, manager
):
    sc = await _make_class(db_session)
    actor = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=actor.id)
    if manager:
        await _grant_permission(db_session, actor, "shop:manage_orders")
    buyer = await _bare_user(db_session, student_id="11520")
    outsider = await _bare_user(db_session, student_id="11620")
    order = await _seed_order(db_session, buyer, class_id=sc.id, total_price=123)
    path = f"/shop/orders/{order.id}/separate"
    assert (await client.post(path)).status_code == 401
    assert (await authed_client_factory(buyer).post(path)).status_code == 403
    assert (await authed_client_factory(outsider).post(path)).status_code == 403
    ac = authed_client_factory(actor)
    response = await ac.post(path)
    assert response.status_code == 200, response.text
    assert response.json()["class_id"] is None
    assert response.json()["supplement_class_id"] == str(sc.id)
    assert response.json()["total_price"] == 123
    assert (await ac.post(path)).status_code == 200
    paid = await _seed_order(db_session, buyer, class_id=sc.id, is_paid=True)
    assert (await ac.post(f"/shop/orders/{paid.id}/separate")).status_code == 409


@pytest.mark.parametrize("manager", [False, True])
async def test_supplement_can_rejoin_class_without_changing_collection_status(
    db_session, client, authed_client_factory, manager
):
    sc = await _make_class(db_session)
    actor = await _bare_user(db_session, student_id="11501")
    if manager:
        await _grant_permission(db_session, actor, "shop:manage_orders")
    else:
        await class_svc.add_cadre(db_session, sc, user_id=actor.id)
    buyer = await _bare_user(db_session, student_id="11520")
    order = await _seed_order(db_session, buyer, total_price=123, is_class_collected=True)
    order.class_id = None
    order.supplement_class_id = sc.id
    order.assistance_scope = "supplement"
    ac = authed_client_factory(actor)
    path = f"/shop/orders/{order.id}/rejoin-class"

    assert (await client.post(path)).status_code == 401
    supplements = await ac.get("/shop/orders/supplements")
    assert [row["id"] for row in supplements.json()] == [str(order.id)]
    response = await ac.post(path)
    assert response.status_code == 200, response.text
    assert response.json()["class_id"] == str(sc.id)
    assert response.json()["supplement_class_id"] is None
    assert response.json()["is_class_collected"] is True
    assert response.json()["is_paid"] is False
    assert response.json()["total_price"] == 123
    assert [row.id for row in await shop_svc.list_orders(db_session, class_ids=[sc.id])] == [
        order.id
    ]
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order.id))
    assert receivable.class_id == sc.id


async def test_supplement_rejoin_denies_other_class_cadre_and_paid_orders(
    db_session, authed_client_factory
):
    sc = await _make_class(db_session)
    other_class = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    other_cadre = await _bare_user(db_session, student_id="11601")
    await class_svc.add_cadre(db_session, other_class, user_id=other_cadre.id)
    buyer = await _bare_user(db_session, student_id="11520")
    order = await _seed_order(db_session, buyer, total_price=123)
    order.supplement_class_id = sc.id
    order.assistance_scope = "supplement"
    denied = await authed_client_factory(other_cadre).post(f"/shop/orders/{order.id}/rejoin-class")
    assert denied.status_code == 403
    assert (await authed_client_factory(other_cadre).get("/shop/orders/supplements")).json() == []
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    order.is_paid = True
    conflict = await authed_client_factory(manager).post(f"/shop/orders/{order.id}/rejoin-class")
    assert conflict.status_code == 409
    assert order.class_id is None and order.supplement_class_id == sc.id


async def test_receivable_payment_rejoins_supplement_only_after_full_collection(
    db_session, authed_client_factory
):
    from api.services import receivable as receivable_svc

    sc = await _make_class(db_session)
    actor = await _bare_user(db_session)
    await _grant_permission(db_session, actor, "shop:manage_orders")
    buyer = await _bare_user(db_session, student_id="11520")
    order = await _seed_order(db_session, buyer, class_id=sc.id, total_price=123)
    assert (
        await authed_client_factory(actor).post(f"/shop/orders/{order.id}/separate")
    ).status_code == 200
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order.id))
    await receivable_svc.mark_paid(db_session, receivable, actor_id=actor.id, paid_amount=20)
    assert order.class_id is None and not order.is_paid
    await receivable_svc.mark_paid(db_session, receivable, actor_id=actor.id)
    assert order.class_id == sc.id and order.is_paid
    assert receivable.class_id == sc.id


@pytest.fixture
async def member_user(make_user):
    return await make_user(email="member@hchs.hc.edu.tw")


async def test_bundle_price_counts_complete_sets_and_keeps_variant_surcharges(
    db_session, client, authed_client_factory
) -> None:
    manager = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    category = await _make_category(db_session, manager)
    shirt = await _make_active_product(db_session, manager, category=category, price=300)
    pants = await _make_active_product(db_session, manager, category=category, price=500)
    group = await shop_svc.add_variant_group(
        db_session,
        shirt,
        data=ProductVariantGroupCreate(
            name="尺寸", options=[ProductVariantOptionCreate(value="加大", price_delta=50)]
        ),
    )
    payload = {
        "name": "衣褲套組",
        "discount_type": "bundle_price",
        "discount_value": 650,
        "target_product_ids": [str(shirt.id), str(pants.id)],
    }
    assert (await client.post("/shop/promotions", json=payload)).status_code == 401
    buyer_client = authed_client_factory(buyer)
    assert (await buyer_client.post("/shop/promotions", json=payload)).status_code == 403
    await _grant_permission(db_session, manager, "shop:manage")
    created = await authed_client_factory(manager).post("/shop/promotions", json=payload)
    assert created.status_code == 201
    assert created.json()["discount_type"] == "bundle_price"
    assert (await client.get("/shop/promotions/available")).json()[0]["discount_value"] == 650

    first = await buyer_client.put(
        f"/shop/registrations/current/products/{shirt.id}",
        json={"variants": [{"option_ids": [str(group.options[0].id)], "quantity": 3}]},
    )
    assert first.status_code == 200
    assert first.json()["total_price"] == 1050
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"category_id": str(category.id)}
    )
    assert preview.status_code == 200
    assert preview.json()["reason_code"] == "items_not_matched"
    for quantity, expected_subtotal, expected_discount, expected_total in [
        (2, 2050, 300, 1750),
        (1, 1550, 150, 1400),
        (0, 1050, 0, 1050),
    ]:
        updated = await buyer_client.put(
            f"/shop/registrations/current/products/{pants.id}",
            json={"variants": [{"option_ids": [], "quantity": quantity}] if quantity else []},
        )
        assert updated.status_code == 200
        assert updated.json()["subtotal_price"] == expected_subtotal
        assert updated.json()["discount_amount"] == expected_discount
        assert updated.json()["total_price"] == expected_total


async def test_bundle_price_validates_targets_price_and_account_scope(
    db_session, authed_client_factory
) -> None:
    manager = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    other = await _bare_user(db_session)
    category = await _make_category(db_session, manager)
    first = await _make_active_product(db_session, manager, category=category, price=100)
    second = await _make_active_product(db_session, manager, category=category, price=200)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    payload = {
        "name": "限定套組",
        "discount_type": "bundle_price",
        "discount_value": 250,
        "target_product_ids": [str(first.id), str(second.id)],
        "target_identifiers": [buyer.email],
    }
    for invalid in [
        {"target_product_ids": [str(first.id)]},
        {"discount_value": 0},
        {"discount_value": 300},
        {"discount_value": 400},
    ]:
        response = await manager_client.post("/shop/promotions", json={**payload, **invalid})
        assert response.status_code == 422
    different_category = await _make_active_product(db_session, manager, price=200)
    cross_category = await manager_client.post(
        "/shop/promotions",
        json={**payload, "target_product_ids": [str(first.id), str(different_category.id)]},
    )
    assert cross_category.status_code == 422
    assert "同一商品分類" in cross_category.json()["detail"]
    created = await manager_client.post("/shop/promotions", json=payload)
    assert created.status_code == 201
    for user, expected_discount in [(buyer, 50), (other, 0)]:
        ac = authed_client_factory(user)
        for product in [first, second]:
            updated = await ac.put(
                f"/shop/registrations/current/products/{product.id}",
                json={"variants": [{"option_ids": [], "quantity": 1}]},
            )
            assert updated.status_code == 200
        assert updated.json()["discount_amount"] == expected_discount
    invalid_update = await manager_client.patch(
        f"/shop/promotions/{created.json()['id']}", json={"target_product_ids": []}
    )
    assert invalid_update.status_code == 422


# ── 測試輔助 ──────────────────────────────────────────────────────────────────


async def _grant_permission(db: AsyncSession, user: User, code: str) -> None:
    """替既有 user 建立一個具備指定權限碼的職位並任命（供 router 權限測試用）。

    get_user_permission_codes 有 180 秒 Redis 快取；若同一 user 在測試中先被判定
    無權限（快取已寫入空集合），這裡直接寫 DB 不會反映到後續請求，必須主動清快取。
    """
    from api.core.cache import cache_invalidate_user_permissions

    org = Org(name=f"org-{uuid.uuid4().hex[:6]}")
    db.add(org)
    await db.flush()
    position = Position(org_id=org.id, name="測試職位")
    db.add(position)
    await db.flush()
    db.add(Permission(position_id=position.id, code=code))
    db.add(UserPosition(user_id=user.id, position_id=position.id, start_date=date.today()))
    await db.flush()
    await cache_invalidate_user_permissions(str(user.id))


async def _make_class(db: AsyncSession, *, start: str = "11501", end: str = "11540", creator=None):
    creator_id = creator.id if creator else (await _bare_user(db)).id
    return await class_svc.create_class(
        db,
        data=SchoolClassCreate(
            academic_year=115,
            class_code=f"c{uuid.uuid4().hex[:4]}",
            grade=1,
            ranges=[ClassStudentRangeCreate(student_id_start=start, student_id_end=end)],
        ),
        created_by=creator_id,
    )


async def _bare_user(db: AsyncSession, *, student_id: str | None = None) -> User:
    user = User(
        email=f"u-{uuid.uuid4().hex[:8]}@hchs.hc.edu.tw",
        display_name="測試使用者",
        is_active=True,
        is_verified=True,
        student_id=student_id,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_category(
    db: AsyncSession, creator: User, *, activity_id: uuid.UUID | None = None, name: str = "商品"
) -> ProductCategory:
    return await shop_svc.create_category(
        db, data=ProductCategoryCreate(name=name, activity_id=activity_id), created_by=creator.id
    )


async def _make_active_product(
    db: AsyncSession,
    creator: User,
    *,
    price: int = 100,
    stock: int = 50,
    category=None,
    max_quantity_per_user: int | None = None,
):
    category = category or await _make_category(db, creator)
    series = await shop_svc.create_series(
        db, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    product = await shop_svc.create_product(
        db,
        data=ProductCreate(
            series_id=series.id,
            name="商品",
            price=price,
            stock_quantity=stock,
            max_quantity_per_user=max_quantity_per_user,
        ),
        created_by=creator.id,
    )
    return await shop_svc.activate_product(db, product)


# ── 圖片上傳 ──────────────────────────────────────────────────────────────────


async def test_upload_image_without_permission_returns_403(
    client, db_session, member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/images", files={"file": ("a.png", _PNG_BYTES, "image/png")})
    assert resp.status_code == 403


async def test_upload_image_with_permission_succeeds(
    db_session, member_user, authed_client_factory, monkeypatch, tmp_path
) -> None:
    from api.services.storage import LocalStorageBackend

    await _grant_permission(db_session, member_user, "shop:manage")
    monkeypatch.setattr(
        "api.routers.shop.get_storage", lambda: LocalStorageBackend(base_dir=str(tmp_path))
    )
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/images", files={"file": ("a.png", _PNG_BYTES, "image/png")})
    assert resp.status_code == 200
    assert resp.json()["url"]


# ── 主題（分類）────────────────────────────────────────────────────────────────


async def test_list_categories_requires_login_only(
    client, db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    await _make_category(db_session, creator)
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/categories")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_public_catalog_does_not_require_login(client, db_session, member_user) -> None:
    product = await _make_active_product(db_session, member_user, price=80)

    response = await client.get("/shop/catalog")
    assert response.status_code == 200
    assert response.json()[0]["series"][0]["products"][0]["id"] == str(product.id)

    detail = await client.get(f"/shop/products/{product.id}")
    assert detail.status_code == 200


async def test_create_category_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/categories", json={"name": "測試主題"})
    assert resp.status_code == 403


async def test_create_category_with_permission_returns_201(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/categories", json={"name": "測試主題"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "測試主題"


async def test_update_category_unknown_id_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/shop/categories/{uuid.uuid4()}", json={"name": "改名"})
    assert resp.status_code == 404


async def test_delete_category_with_series_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/categories/{category.id}")
    assert resp.status_code == 409


async def test_delete_empty_category_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/categories/{category.id}")
    assert resp.status_code == 204


async def test_delete_category_with_delegation_link_returns_409(
    db_session: AsyncSession, member_user: User, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    link = ShopDelegationLink(
        user_id=member_user.id,
        category_id=category.id,
        name="測試授權",
        token_hash="a" * 64,
    )
    db_session.add(link)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/categories/{category.id}")

    assert resp.status_code == 409
    assert "代訂授權連結" in resp.json()["detail"]
    assert (
        await db_session.scalar(select(ProductCategory.id).where(ProductCategory.id == category.id))
        == category.id
    )
    assert (
        await db_session.scalar(
            select(ShopDelegationLink.id).where(ShopDelegationLink.id == link.id)
        )
        == link.id
    )


# ── 系列 ──────────────────────────────────────────────────────────────────────


async def test_create_series_unknown_category_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/series", json={"category_id": str(uuid.uuid4()), "name": "系列"})
    assert resp.status_code == 404


async def test_update_series_unknown_id_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/shop/series/{uuid.uuid4()}", json={"name": "改名"})
    assert resp.status_code == 404


async def test_delete_series_with_product_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    await shop_svc.create_product(
        db_session,
        data=ProductCreate(series_id=series.id, name="商品", price=10),
        created_by=member_user.id,
    )
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/series/{series.id}")
    assert resp.status_code == 409


# ── 購買頁瀏覽樹 ──────────────────────────────────────────────────────────────


async def test_get_catalog_lists_active_products(
    db_session, member_user, authed_client_factory
) -> None:
    await _make_active_product(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/catalog")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["series"][0]["products"][0]["status"] == "active"


async def test_list_products_includes_purchase_limit(db_session, member_user, client) -> None:
    product = await _make_active_product(db_session, member_user, max_quantity_per_user=2)

    response = await client.get("/shop/products")

    assert response.status_code == 200
    listed = next(item for item in response.json() if item["id"] == str(product.id))
    assert listed["max_quantity_per_user"] == 2


# ── 商品 ──────────────────────────────────────────────────────────────────────


async def test_get_product_unknown_id_returns_404(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/shop/products/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_create_product_unknown_series_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        "/shop/products",
        json={"series_id": str(uuid.uuid4()), "name": "商品", "price": 10},
    )
    assert resp.status_code == 404


async def test_create_product_without_permission_returns_403(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    category = await _make_category(db_session, creator)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        "/shop/products",
        json={"series_id": str(series.id), "name": "商品", "price": 10},
    )
    assert resp.status_code == 403


async def test_product_lifecycle_activate_and_deactivate(
    db_session, member_user, authed_client_factory
) -> None:
    """草稿 → 上架 → 下架的完整流程，並驗證不合法的狀態轉移回傳 409。"""
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    ac = authed_client_factory(member_user)
    created = await ac.post(
        "/shop/products",
        json={"series_id": str(series.id), "name": "商品", "price": 10, "stock_quantity": 5},
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    assert created.json()["status"] == "draft"

    # 草稿狀態下不可下架
    bad_deactivate = await ac.post(f"/shop/products/{product_id}/deactivate")
    assert bad_deactivate.status_code == 409

    activated = await ac.post(f"/shop/products/{product_id}/activate")
    assert activated.status_code == 200
    assert activated.json()["status"] == "active"

    # 已上架不可重複上架
    bad_activate = await ac.post(f"/shop/products/{product_id}/activate")
    assert bad_activate.status_code == 409

    updated = await ac.patch(f"/shop/products/{product_id}", json={"price": 20})
    assert updated.status_code == 200
    assert updated.json()["price"] == 20

    deactivated = await ac.post(f"/shop/products/{product_id}/deactivate")
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "cancelled"


async def test_update_product_allowed_for_activity_convener_without_shop_manage(
    db_session, member_user, authed_client_factory
) -> None:
    """驗證 _require_shop_manager 的第二條路徑：活動總召可管理自己活動下的商品，不需要 shop:manage。"""
    creator = await _bare_user(db_session)
    org = Org(name="活動部")
    activity = Activity(name="園遊會", org=org, status=ActivityStatus.ACTIVE)
    db_session.add_all([org, activity])
    await db_session.flush()
    convener = ActivityConvener(
        activity_id=activity.id,
        user_id=member_user.id,
        start_date=date.today() - timedelta(days=1),
    )
    db_session.add(convener)
    await db_session.flush()

    category = await _make_category(db_session, creator, activity_id=activity.id)
    product = await _make_active_product(db_session, creator, category=category)

    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/shop/products/{product.id}", json={"price": 999})
    assert resp.status_code == 200
    assert resp.json()["price"] == 999


# ── 變體群組 / 選項 ───────────────────────────────────────────────────────────


async def test_variant_group_and_option_crud_requires_manage_permission(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    category = await _make_category(db_session, creator)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(series_id=series.id, name="商品", price=10),
        created_by=creator.id,
    )

    ac = authed_client_factory(member_user)
    forbidden = await ac.post(f"/shop/products/{product.id}/variant-groups", json={"name": "顏色"})
    assert forbidden.status_code == 403

    await _grant_permission(db_session, member_user, "shop:manage")
    group_resp = await ac.post(f"/shop/products/{product.id}/variant-groups", json={"name": "顏色"})
    assert group_resp.status_code == 201
    group_id = group_resp.json()["id"]

    updated_group = await ac.patch(f"/shop/variant-groups/{group_id}", json={"name": "色系"})
    assert updated_group.status_code == 200
    assert updated_group.json()["name"] == "色系"

    option_resp = await ac.post(f"/shop/variant-groups/{group_id}/options", json={"value": "黑"})
    assert option_resp.status_code == 201
    option_id = option_resp.json()["id"]

    updated_option = await ac.patch(f"/shop/variant-options/{option_id}", json={"price_delta": 30})
    assert updated_option.status_code == 200
    assert updated_option.json()["price_delta"] == 30

    deleted_option = await ac.delete(f"/shop/variant-options/{option_id}")
    assert deleted_option.status_code == 204

    deleted_group = await ac.delete(f"/shop/variant-groups/{group_id}")
    assert deleted_group.status_code == 204


# ── 商品登記 ──────────────────────────────────────────────────────────────────


async def test_cart_and_checkout_routes_are_removed(client) -> None:
    assert (await client.get("/shop/cart")).status_code == 404
    assert (await client.post("/shop/cart/checkout", json={})).status_code == 404


async def test_current_registration_requires_login(client) -> None:
    assert (await client.get("/shop/registrations/current")).status_code == 401
    assert (
        await client.post("/shop/registrations/current/promotion/preview", json={"code": None})
    ).status_code == 401
    assert (
        await client.put("/shop/registrations/current/promotion", json={"code": "SAVE50"})
    ).status_code == 401
    assert (
        await client.put(
            f"/shop/registrations/current/products/{uuid.uuid4()}",
            json={"variants": []},
        )
    ).status_code == 401


async def test_shop_activity_options_only_include_accessible_active_activities(
    client, db_session, member_user, authed_client_factory
) -> None:
    first = Activity(name="校商預購", status=ActivityStatus.ACTIVE)
    second = Activity(name="五校聯合聖誕傳情", status=ActivityStatus.ACTIVE)
    archived = Activity(name="已封存活動", status=ActivityStatus.ARCHIVED)
    db_session.add_all([first, second, archived])
    await db_session.flush()

    assert (await client.get("/shop/activities")).status_code == 401
    member_client = authed_client_factory(member_user)
    assert (await member_client.get("/shop/activities")).json() == []

    db_session.add(
        ActivityConvener(
            activity_id=first.id,
            user_id=member_user.id,
            start_date=date.today() - timedelta(days=1),
        )
    )
    await db_session.flush()
    own_activities = await member_client.get("/shop/activities")
    assert own_activities.status_code == 200
    assert [row["id"] for row in own_activities.json()] == [str(first.id)]

    await _grant_permission(db_session, member_user, "shop:manage")
    manager_activities = await member_client.get("/shop/activities")
    assert manager_activities.status_code == 200
    assert {row["id"] for row in manager_activities.json()} == {
        str(first.id),
        str(second.id),
    }


async def test_category_activity_update_checks_both_activity_scopes(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    first = Activity(name="校商預購", status=ActivityStatus.ACTIVE)
    second = Activity(name="五校聯合聖誕傳情", status=ActivityStatus.ACTIVE)
    db_session.add_all([first, second])
    await db_session.flush()
    db_session.add(
        ActivityConvener(
            activity_id=first.id,
            user_id=member_user.id,
            start_date=date.today() - timedelta(days=1),
        )
    )
    category = await _make_category(db_session, creator, activity_id=first.id)
    await db_session.flush()
    category_client = authed_client_factory(member_user)

    move_to_other_activity = await category_client.patch(
        f"/shop/categories/{category.id}", json={"activity_id": str(second.id)}
    )
    assert move_to_other_activity.status_code == 403
    move_to_general = await category_client.patch(
        f"/shop/categories/{category.id}", json={"activity_id": None}
    )
    assert move_to_general.status_code == 403


async def test_assigning_categories_to_activities_splits_preorders(
    db_session, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session, student_id="11510")
    manager = await _bare_user(db_session)
    first = Activity(name="校商預購", status=ActivityStatus.ACTIVE)
    second = Activity(name="五校聯合聖誕傳情", status=ActivityStatus.ACTIVE)
    db_session.add_all([first, second])
    await db_session.flush()

    first_category = await _make_category(db_session, creator, name="校商商品")
    second_category = await _make_category(db_session, creator, name="傳情卡")
    first_product = await _make_active_product(db_session, creator, category=first_category)
    second_product = await _make_active_product(db_session, creator, category=second_category)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)

    for category, activity in ((first_category, first), (second_category, second)):
        updated = await manager_client.patch(
            f"/shop/categories/{category.id}", json={"activity_id": str(activity.id)}
        )
        assert updated.status_code == 200
        assert updated.json()["activity_id"] == str(activity.id)

    buyer_client = authed_client_factory(buyer)
    first_order = await buyer_client.put(
        f"/shop/registrations/current/products/{first_product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    second_order = await buyer_client.put(
        f"/shop/registrations/current/products/{second_product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert first_order.status_code == second_order.status_code == 200
    assert first_order.json()["id"] != second_order.json()["id"]
    assert first_order.json()["activity_id"] == str(first.id)
    assert second_order.json()["activity_id"] == str(second.id)

    registrations = await buyer_client.get("/shop/registrations")
    assert {row["activity_id"] for row in registrations.json()} == {
        str(first.id),
        str(second.id),
    }


async def test_current_registration_is_scoped_to_authenticated_user(
    db_session, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    owner = await _bare_user(db_session)
    other_user = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=50, stock=5)
    owner_client = authed_client_factory(owner)
    other_client = authed_client_factory(other_user)

    owner_saved = await owner_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert owner_saved.status_code == 200
    assert (await other_client.get("/shop/registrations/current")).json() is None

    other_saved = await other_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert other_saved.status_code == 200
    assert other_saved.json()["id"] != owner_saved.json()["id"]
    assert (await owner_client.get("/shop/registrations/current")).json()[
        "id"
    ] == owner_saved.json()["id"]
    assert (await other_client.get("/shop/registrations/current")).json()[
        "id"
    ] == other_saved.json()["id"]


async def test_registration_is_saved_and_can_be_changed_or_removed(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=50, stock=5)
    group = await shop_svc.add_variant_group(
        db_session,
        product,
        data=ProductVariantGroupCreate(
            name="尺寸",
            options=[
                ProductVariantOptionCreate(value="標準"),
                ProductVariantOptionCreate(value="加大", price_delta=25),
            ],
        ),
    )
    standard_option, large_option = group.options
    ac = authed_client_factory(member_user)

    empty = await ac.get("/shop/registrations/current")
    assert empty.status_code == 200
    assert empty.json() is None

    added = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [str(standard_option.id)], "quantity": 2}]},
    )
    assert added.status_code == 200
    order = added.json()
    assert order["total_price"] == 100
    assert order["items"][0]["quantity"] == 2
    assert product.stock_quantity == 3

    updated = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [str(large_option.id)], "quantity": 3}]},
    )
    assert updated.status_code == 200
    assert updated.json()["total_price"] == 225
    assert updated.json()["items"][0]["quantity"] == 3
    assert updated.json()["items"][0]["selected_options"][0]["option_id"] == str(large_option.id)
    assert product.stock_quantity == 2

    removed = await ac.put(
        f"/shop/registrations/current/products/{product.id}", json={"variants": []}
    )
    assert removed.status_code == 200
    assert removed.json()["status"] == "cancelled"
    assert removed.json()["items"] == []
    assert product.stock_quantity == 5
    assert (await ac.get("/shop/registrations/current")).json() is None


async def test_registration_enforces_purchase_limit_and_sale_deadline(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    limited = await _make_active_product(
        db_session, creator, price=50, stock=5, max_quantity_per_user=2
    )
    ac = authed_client_factory(member_user)
    saved = await ac.put(
        f"/shop/registrations/current/products/{limited.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert saved.status_code == 200
    too_many = await ac.put(
        f"/shop/registrations/current/products/{limited.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert too_many.status_code == 422
    assert "每人限購 2 件" in too_many.json()["detail"]

    expired = await _make_active_product(db_session, creator)
    expired.sale_end = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.flush()
    closed = await ac.put(
        f"/shop/registrations/current/products/{expired.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert closed.status_code == 409
    assert "已截止登記" in closed.json()["detail"]


async def test_registration_automatically_applies_account_item_quantity_promotion(
    db_session, client, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    other_buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=100, stock=20)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)

    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "指定帳號三件優惠",
            "target_identifiers": [buyer.email],
            "target_product_ids": [str(product.id)],
            "min_quantity": 3,
            "discount_type": "percentage",
            "discount_value": 20,
            "min_order_price": 0,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]

    public_response = await client.get("/shop/promotions/available")
    assert public_response.status_code == 200
    assert public_response.json() == []
    buyer_client = authed_client_factory(buyer)
    buyer_promotions = await buyer_client.get("/shop/promotions/available")
    assert buyer_promotions.status_code == 200
    assert [row["id"] for row in buyer_promotions.json()] == [promotion_id]
    assert "target_users" not in buyer_promotions.json()[0]
    assert "email" not in str(buyer_promotions.json()[0])
    assert (await authed_client_factory(other_buyer).get("/shop/promotions/available")).json() == []

    two_items = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert two_items.status_code == 200
    assert two_items.json()["discount_amount"] == 0
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": None}
    )
    assert preview.status_code == 200
    assert preview.json()["reason_code"] == "quantity_not_met"
    assert preview.json()["quantity_shortfall"] == 1

    three_items = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert three_items.status_code == 200
    assert three_items.json()["promotion_id"] == promotion_id
    assert three_items.json()["discount_amount"] == 60
    assert three_items.json()["total_price"] == 240

    outsider_order = await authed_client_factory(other_buyer).put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert outsider_order.status_code == 200
    assert outsider_order.json()["discount_amount"] == 0


async def test_new_promotion_updates_existing_registration_without_resubmitting(
    db_session, client, authed_client_factory
) -> None:
    manager = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    product = await _make_active_product(db_session, manager, price=100, stock=20)
    await _grant_permission(db_session, manager, "shop:manage")
    buyer_client = authed_client_factory(buyer)
    order = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert order.status_code == 200
    assert order.json()["total_price"] == 200
    payload = {
        "name": "登記後追加優惠",
        "target_product_ids": [str(product.id)],
        "discount_type": "fixed",
        "discount_value": 30,
    }
    assert (await client.post("/shop/promotions", json=payload)).status_code == 401
    assert (await buyer_client.post("/shop/promotions", json=payload)).status_code == 403
    manager_client = authed_client_factory(manager)
    created = await manager_client.post("/shop/promotions", json=payload)
    assert created.status_code == 201
    assert created.json()["used_count"] == 1
    fetched = await buyer_client.get(f"/shop/orders/{order.json()['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["total_price"] == 170
    assert fetched.json()["discount_amount"] == 30

    updated = await manager_client.patch(
        f"/shop/promotions/{created.json()['id']}", json={"discount_value": 50}
    )
    assert updated.status_code == 200
    fetched = await buyer_client.get(f"/shop/orders/{order.json()['id']}")
    assert fetched.json()["total_price"] == 150


async def test_unregistered_student_id_promotion_applies_after_account_registration(
    db_session, client, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    other_buyer = await _bare_user(db_session, student_id="410998")
    target_student_id = "410999"
    product = await _make_active_product(db_session, creator, price=100, stock=20)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)

    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "新生註冊優惠",
            "target_identifiers": [target_student_id],
            "target_product_ids": [str(product.id)],
            "discount_type": "percentage",
            "discount_value": 20,
            "min_order_price": 0,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]
    assert created.json()["target_users"] == [{"email": None, "student_id": target_student_id}]
    code_promotion = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "新生優惠碼",
            "code": "FIRSTREG",
            "target_identifiers": [target_student_id],
            "discount_type": "percentage",
            "discount_value": 10,
            "min_order_price": 0,
        },
    )
    assert code_promotion.status_code == 201
    assert (await client.get("/shop/promotions/available")).json() == []
    assert (await authed_client_factory(other_buyer).get("/shop/promotions/available")).json() == []

    buyer = await _bare_user(db_session, student_id=target_student_id)
    buyer_client = authed_client_factory(buyer)
    available = await buyer_client.get("/shop/promotions/available")
    assert available.status_code == 200
    assert {row["id"] for row in available.json()} == {
        promotion_id,
        code_promotion.json()["id"],
    }

    order = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert order.status_code == 200
    assert order.json()["promotion_id"] == promotion_id
    assert order.json()["discount_amount"] == 20
    assert order.json()["total_price"] == 80

    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "FIRSTREG"}
    )
    assert preview.status_code == 200
    assert preview.json()["reason_code"] == "applied"

    applied = await buyer_client.put(
        "/shop/registrations/current/promotion", json={"code": "FIRSTREG"}
    )
    assert applied.status_code == 200
    assert applied.json()["promotion_code"] == "FIRSTREG"


async def test_shop_manager_can_edit_and_delete_unused_promotion(
    db_session, authed_client_factory
) -> None:
    manager = await _bare_user(db_session)
    outsider = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    outsider_client = authed_client_factory(outsider)

    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "原優惠名稱",
            "code": "SAVE10",
            "discount_type": "percentage",
            "discount_value": 10,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]

    forbidden = await outsider_client.delete(f"/shop/promotions/{promotion_id}")
    assert forbidden.status_code == 403

    updated = await manager_client.patch(
        f"/shop/promotions/{promotion_id}",
        json={"name": "更新後名稱", "code": "SAVE20", "discount_value": 20},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "更新後名稱"
    assert updated.json()["code"] == "SAVE20"
    assert updated.json()["discount_value"] == 20

    deleted = await manager_client.delete(f"/shop/promotions/{promotion_id}")
    assert deleted.status_code == 204
    missing = await manager_client.delete(f"/shop/promotions/{promotion_id}")
    assert missing.status_code == 404
    remaining = await manager_client.get("/shop/promotions?include_inactive=true")
    assert remaining.status_code == 200
    assert all(row["id"] != promotion_id for row in remaining.json())


async def test_public_coupon_requires_product_bundle_spend_and_quantity(
    db_session, client, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    category = await _make_category(db_session, creator)
    first = await _make_active_product(db_session, creator, category=category, price=100, stock=20)
    second = await _make_active_product(db_session, creator, category=category, price=100, stock=20)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "雙品滿件消費優惠",
            "target_product_ids": [str(first.id), str(second.id)],
            "code": "PAIR50",
            "min_quantity": 2,
            "min_order_price": 450,
            "discount_type": "fixed",
            "discount_value": 50,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]
    available = await client.get("/shop/promotions/available")
    assert available.status_code == 200
    assert available.json()[0]["code"] == "PAIR50"
    assert len(available.json()[0]["target_products"]) == 2

    buyer_client = authed_client_factory(buyer)
    first_only = await buyer_client.put(
        f"/shop/registrations/current/products/{first.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert first_only.status_code == 200
    missing_item = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "pair50"}
    )
    assert missing_item.status_code == 200
    assert missing_item.json()["reason_code"] == "items_not_matched"

    both_items = await buyer_client.put(
        f"/shop/registrations/current/products/{second.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert both_items.status_code == 200
    below_spend = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "PAIR50"}
    )
    assert below_spend.json()["reason_code"] == "minimum_not_met"
    assert below_spend.json()["shortfall"] == 50

    enough_spend = await buyer_client.put(
        f"/shop/registrations/current/products/{first.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert enough_spend.status_code == 200
    eligible = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "pair50"}
    )
    assert eligible.json()["eligible"] is True
    assert eligible.json()["discount_amount"] == 50
    applied = await buyer_client.put(
        "/shop/registrations/current/promotion", json={"code": "pair50"}
    )
    assert applied.status_code == 200
    assert applied.json()["promotion_code"] == "PAIR50"
    assert applied.json()["discount_amount"] == 50
    assert applied.json()["total_price"] == 450

    cannot_delete_used = await manager_client.delete(f"/shop/promotions/{promotion_id}")
    assert cannot_delete_used.status_code == 409
    assert "使用紀錄" in cannot_delete_used.json()["detail"]


async def test_hidden_coupon_is_omitted_from_public_list_but_can_be_redeemed(
    db_session, client, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    outsider = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=100, stock=10)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "隱藏彩蛋優惠",
            "code": "EASTER20",
            "discount_type": "percentage",
            "discount_value": 20,
            "is_public": False,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]
    assert created.json()["is_public"] is False
    assert (await client.get("/shop/promotions/available")).json() == []

    forbidden = await authed_client_factory(outsider).patch(
        f"/shop/promotions/{promotion_id}", json={"is_public": True}
    )
    assert forbidden.status_code == 403

    buyer_client = authed_client_factory(buyer)
    registered = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert registered.status_code == 200
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "EASTER20"}
    )
    assert preview.status_code == 200
    assert preview.json()["eligible"] is True
    assert preview.json()["discount_amount"] == 20
    applied = await buyer_client.put(
        "/shop/registrations/current/promotion", json={"code": "EASTER20"}
    )
    assert applied.status_code == 200
    assert applied.json()["promotion_code"] == "EASTER20"
    assert applied.json()["discount_amount"] == 20

    null_visibility = await manager_client.patch(
        f"/shop/promotions/{promotion_id}", json={"is_public": None}
    )
    assert null_visibility.status_code == 422

    published = await manager_client.patch(
        f"/shop/promotions/{promotion_id}", json={"is_public": True}
    )
    assert published.status_code == 200
    assert published.json()["is_public"] is True
    available = await buyer_client.get("/shop/promotions/available")
    assert [row["id"] for row in available.json()] == [promotion_id]


async def test_coupon_applies_configured_prices_to_multiple_products(
    db_session, client, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    category = await _make_category(db_session, creator)
    first = await _make_active_product(db_session, creator, category=category, price=50, stock=10)
    second = await _make_active_product(db_session, creator, category=category, price=80, stock=10)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)

    incomplete = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "雙品優惠價",
            "code": "PAIRPRICE",
            "discount_type": "price_override",
            "discount_value": 0,
            "target_product_ids": [str(first.id), str(second.id)],
            "product_price_overrides": [{"product_id": str(first.id), "unit_price": 40}],
        },
    )
    assert incomplete.status_code == 422
    assert "設定優惠後單價" in incomplete.json()["detail"]

    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "雙品優惠價",
            "code": "PAIRPRICE",
            "discount_type": "price_override",
            "discount_value": 0,
            "target_product_ids": [str(first.id), str(second.id)],
            "product_price_overrides": [
                {"product_id": str(first.id), "unit_price": 40},
                {"product_id": str(second.id), "unit_price": 60},
            ],
            "is_public": False,
        },
    )
    assert created.status_code == 201
    assert created.json()["is_public"] is False
    assert {row["unit_price"] for row in created.json()["product_price_overrides"]} == {40, 60}
    assert (await client.get("/shop/promotions/available")).json() == []

    buyer_client = authed_client_factory(buyer)
    registered = await buyer_client.put(
        f"/shop/registrations/current/products/{first.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert registered.status_code == 200
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "PAIRPRICE"}
    )
    assert preview.status_code == 200
    assert preview.json()["eligible"] is True
    assert preview.json()["discount_amount"] == 10
    assert preview.json()["total_price"] == 40
    assert len(preview.json()["product_price_overrides"]) == 2

    applied = await buyer_client.put(
        "/shop/registrations/current/promotion", json={"code": "PAIRPRICE"}
    )
    assert applied.status_code == 200
    assert applied.json()["subtotal_price"] == 50
    assert applied.json()["discount_amount"] == 10
    assert applied.json()["total_price"] == 40

    added_second_product = await buyer_client.put(
        f"/shop/registrations/current/products/{second.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert added_second_product.status_code == 200
    assert added_second_product.json()["subtotal_price"] == 130
    assert added_second_product.json()["discount_amount"] == 30
    assert added_second_product.json()["total_price"] == 100


async def test_activity_orders_keep_separate_and_stack_scoped_coupon_with_automatic_discount(
    db_session, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session, student_id="11510")
    manager = await _bare_user(db_session)
    school_class = await _make_class(db_session)
    org = Org(name=f"活動-{uuid.uuid4().hex[:6]}")
    first_activity = Activity(name="校慶預購", org=org, status=ActivityStatus.ACTIVE)
    second_activity = Activity(name="社團活動", org=org, status=ActivityStatus.ACTIVE)
    db_session.add_all([org, first_activity, second_activity])
    await db_session.flush()
    card_category = await _make_category(
        db_session, creator, activity_id=first_activity.id, name="卡片"
    )
    hat_category = await _make_category(
        db_session, creator, activity_id=first_activity.id, name="帽子"
    )
    other_category = await _make_category(
        db_session, creator, activity_id=second_activity.id, name="社團商品"
    )
    cards = await _make_active_product(db_session, creator, price=40, category=card_category)
    hats = await _make_active_product(db_session, creator, price=999, category=hat_category)
    other_product = await _make_active_product(
        db_session, creator, price=100, category=other_category
    )
    catalog = await authed_client_factory(buyer).get("/shop/catalog")
    assert catalog.status_code == 200
    assert {row["activity_name"] for row in catalog.json()} == {"校慶預購", "社團活動"}
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    auto = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "第二件折抵",
            "target_product_ids": [str(hats.id)],
            "min_quantity": 2,
            "discount_type": "fixed",
            "discount_value": 20,
        },
    )
    assert auto.status_code == 201
    assert auto.json()["activity_id"] == str(first_activity.id)
    coupon = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "校慶九折",
            "activity_id": str(first_activity.id),
            "code": "FESTIVAL10",
            "discount_type": "percentage",
            "discount_value": 10,
            "min_order_price": 1000,
        },
    )
    assert coupon.status_code == 201

    buyer_client = authed_client_factory(buyer)
    card_order = await buyer_client.put(
        f"/shop/registrations/current/products/{cards.id}",
        json={"variants": [{"option_ids": [], "quantity": 4}]},
    )
    assert card_order.status_code == 200
    hat_order = await buyer_client.put(
        f"/shop/registrations/current/products/{hats.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert hat_order.status_code == 200
    assert hat_order.json()["activity_id"] == str(first_activity.id)
    assert hat_order.json()["discount_amount"] == 20
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview",
        json={"code": "FESTIVAL10", "activity_id": str(first_activity.id)},
    )
    assert preview.status_code == 200
    assert preview.json()["discount_amount"] == 235
    assert preview.json()["total_price"] == 1923
    applied = await buyer_client.put(
        "/shop/registrations/current/promotion",
        json={"code": "FESTIVAL10", "activity_id": str(first_activity.id)},
    )
    assert applied.status_code == 200
    assert applied.json()["discount_amount"] == 235
    assert applied.json()["total_price"] == 1923
    assert {row["promotion_id"] for row in applied.json()["applied_promotions"]} == {
        auto.json()["id"],
        coupon.json()["id"],
    }

    other_order = await buyer_client.put(
        f"/shop/registrations/current/products/{other_product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert other_order.status_code == 200
    assert other_order.json()["id"] != applied.json()["id"]
    mismatch = await buyer_client.post(
        "/shop/registrations/current/promotion/preview",
        json={"code": "FESTIVAL10", "activity_id": str(second_activity.id)},
    )
    assert mismatch.status_code == 200
    assert mismatch.json()["reason_code"] == "activity_not_matched"

    registrations = await buyer_client.get("/shop/registrations")
    assert registrations.status_code == 200
    assert {row["activity_id"] for row in registrations.json()} == {
        str(first_activity.id),
        str(second_activity.id),
    }
    by_activity = {row["activity_name"]: row for row in registrations.json()}
    assert {item["product_id"]: item["quantity"] for item in by_activity["校慶預購"]["items"]} == {
        str(cards.id): 4,
        str(hats.id): 2,
    }
    listed = await buyer_client.get("/shop/orders", params={"my_only": "true"})
    assert listed.status_code == 200
    assert {row["activity_name"] for row in listed.json()} == {"校慶預購", "社團活動"}
    listed_by_activity = {row["activity_name"]: row for row in listed.json()}
    assert {
        item["product_id"]: item["quantity"] for item in listed_by_activity["校慶預購"]["items"]
    } == {
        str(cards.id): 4,
        str(hats.id): 2,
    }
    first_order_id = applied.json()["id"]
    second_order_id = other_order.json()["id"]
    first_order = await shop_svc.get_order(db_session, uuid.UUID(first_order_id))
    second_order = await shop_svc.get_order(db_session, uuid.UUID(second_order_id))
    assert first_order is not None and second_order is not None
    await shop_svc.set_class_collected(
        db_session, second_order, collected=True, actor_id=manager.id
    )
    assert first_order.is_class_collected is False
    assert second_order.is_class_collected is True

    first_paid = await manager_client.patch(
        f"/shop/orders/classes/{school_class.id}/payment",
        json={"is_paid": True, "activity_id": str(first_activity.id)},
    )
    assert first_paid.status_code == 200
    assert first_paid.json()["updated_orders"] == 1
    await db_session.refresh(first_order)
    await db_session.refresh(second_order)
    assert first_order.is_paid is True
    assert second_order.is_paid is False
    second_paid = await manager_client.patch(
        f"/shop/orders/classes/{school_class.id}/payment",
        json={"is_paid": True, "activity_id": str(second_activity.id)},
    )
    assert second_paid.status_code == 200
    await db_session.refresh(second_order)
    assert second_order.is_paid is True


async def test_direct_class_order_splits_items_across_activities(db_session) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    org = Org(name=f"活動-{uuid.uuid4().hex[:6]}")
    first_activity = Activity(name="活動一", org=org, status=ActivityStatus.ACTIVE)
    second_activity = Activity(name="活動二", org=org, status=ActivityStatus.ACTIVE)
    db_session.add_all([org, first_activity, second_activity])
    await db_session.flush()
    first_product = await _make_active_product(
        db_session,
        creator,
        category=await _make_category(db_session, creator, activity_id=first_activity.id),
    )
    second_product = await _make_active_product(
        db_session,
        creator,
        category=await _make_category(db_session, creator, activity_id=second_activity.id),
    )
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=None,
        data=ClassOrderUpsert(
            user_id=buyer.id,
            items=[
                OrderItemCreate(product_id=first_product.id, quantity=1, option_ids=[]),
                OrderItemCreate(product_id=second_product.id, quantity=1, option_ids=[]),
            ],
        ),
    )
    assert len(orders) == 2
    assert {order.activity_id for order in orders} == {first_activity.id, second_activity.id}
    full_orders = [await shop_svc.get_order(db_session, order.id) for order in orders]
    assert all(order is not None and len(order.items) == 1 for order in full_orders)


async def test_product_cannot_be_deleted_while_used_by_promotion(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator)
    await _grant_permission(db_session, member_user, "shop:manage")
    manager_client = authed_client_factory(member_user)
    promotion = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "指定商品優惠",
            "target_product_ids": [str(product.id)],
            "discount_type": "fixed",
            "discount_value": 10,
            "min_order_price": 0,
        },
    )
    assert promotion.status_code == 201

    deleted = await manager_client.delete(f"/shop/products/{product.id}")
    assert deleted.status_code == 409
    assert "先從優惠" in deleted.json()["detail"]


async def test_class_collection_locks_user_registration(db_session, authed_client_factory) -> None:
    school_class = await _make_class(db_session, start="11501", end="11540")
    buyer = await _bare_user(db_session, student_id="11510")
    creator = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=50)
    ac = authed_client_factory(buyer)
    created = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert created.status_code == 200
    order_id = uuid.UUID(created.json()["id"])
    order = await shop_svc.get_order(db_session, order_id)
    assert order is not None and order.class_id == school_class.id
    await shop_svc.set_class_collected(db_session, order, collected=True, actor_id=buyer.id)

    locked = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": []},
    )
    assert locked.status_code == 409
    assert "已收款或鎖定" in locked.json()["detail"]


@pytest.mark.parametrize("paid", [False, True])
async def test_student_adds_after_collection_and_cadre_sees_only_supplement(
    db_session, authed_client_factory, paid
) -> None:
    school_class = await _make_class(db_session, start="11501", end="11540")
    buyer = await _bare_user(db_session, student_id="11510")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, school_class, user_id=cadre.id)
    product = await _make_active_product(db_session, cadre, price=50)
    product.max_quantity_per_user = 4
    ac = authed_client_factory(buyer)
    endpoint = f"/shop/registrations/current/products/{product.id}"
    initial = await ac.put(endpoint, json={"variants": [{"option_ids": [], "quantity": 1}]})
    assert initial.status_code == 200
    original = await shop_svc.get_order(db_session, uuid.UUID(initial.json()["id"]))
    await shop_svc.set_class_collected(db_session, original, collected=True, actor_id=cadre.id)
    if paid:
        await shop_svc.set_order_paid(db_session, original, is_paid=True, actor_id=cadre.id)
    collected_at = original.class_collected_at

    addition = await ac.put(endpoint, json={"variants": [{"option_ids": [], "quantity": 3}]})
    assert addition.status_code == 200
    extra = addition.json()
    assert extra["id"] != str(original.id)
    assert extra["total_price"] == 100
    assert extra["items"][0]["quantity"] == 2
    assert extra["is_class_collected"] is False and extra["is_paid"] is False
    # 重送總量不會重複加購，限購仍計入先前已收款品項。
    repeated = await ac.put(endpoint, json={"variants": [{"option_ids": [], "quantity": 3}]})
    assert repeated.status_code == 200 and repeated.json()["id"] == extra["id"]
    assert (await ac.put(endpoint, json={"variants": [{"quantity": 5}]})).status_code == 422
    current = (await ac.get("/shop/registrations")).json()
    assert {row["id"] for row in current} == {str(original.id), extra["id"]}
    assert (await db_session.get(Product, product.id, populate_existing=True)).stock_quantity == 47

    cadre_client = authed_client_factory(cadre)
    summary = (await cadre_client.get("/shop/orders/class/summary")).json()
    assert summary["total_amount"] == 150
    assert summary["paid_amount"] == 50 and summary["unpaid_amount"] == 100
    collected = await cadre_client.patch(
        f"/shop/orders/{extra['id']}/collection", json={"is_class_collected": True}
    )
    assert collected.status_code == 200
    summary = (await cadre_client.get("/shop/orders/class/summary")).json()
    assert summary["paid_amount"] == 150 and summary["unpaid_amount"] == 0
    # 再次補收後還能繼續加購，舊單的金額、收款時間及正式入帳狀態不變。
    next_addition = await ac.put(endpoint, json={"variants": [{"quantity": 4}]})
    assert next_addition.status_code == 200
    assert next_addition.json()["total_price"] == 50
    await db_session.refresh(original)
    assert original.total_price == 50 and original.class_collected_at == collected_at
    assert original.is_paid is paid


# ── 訂單 ──────────────────────────────────────────────────────────────────────


async def _seed_order(
    db: AsyncSession,
    buyer: User,
    *,
    class_id=None,
    total_price: int = 100,
    is_paid: bool = False,
    is_class_collected: bool = False,
) -> Order:
    order = Order(
        serial_number=f"ORD-TEST-{uuid.uuid4().hex[:8]}",
        user_id=buyer.id,
        class_id=class_id,
        status=OrderStatus.PENDING,
        total_price=total_price,
        is_paid=is_paid,
        is_class_collected=is_class_collected,
    )
    db.add(order)
    await db.flush()
    return order


async def test_list_orders_defaults_to_own_orders_only(db_session, authed_client_factory) -> None:
    owner = await _bare_user(db_session)
    other = await _bare_user(db_session)
    await _seed_order(db_session, owner)
    await _seed_order(db_session, other)

    ac = authed_client_factory(owner)
    resp = await ac.get("/shop/orders")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["user_id"] == str(owner.id)


async def test_list_orders_admin_view_sees_all_orders(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:view_all")
    other = await _bare_user(db_session)
    await _seed_order(db_session, other)
    await _seed_order(db_session, member_user)

    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders", params={"my_only": "false"})
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    mine = await ac.get("/shop/orders")
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0]["user_id"] == str(member_user.id)


async def test_get_order_hidden_for_unrelated_user_returns_404(
    db_session, authed_client_factory
) -> None:
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(stranger)
    resp = await ac.get(f"/shop/orders/{order.id}")
    assert resp.status_code == 404


async def test_get_order_visible_to_owner(db_session, authed_client_factory) -> None:
    owner = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(owner)
    resp = await ac.get(f"/shop/orders/{order.id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == str(order.id)


async def test_cancel_order_by_unrelated_user_returns_403(
    db_session, authed_client_factory
) -> None:
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(stranger)
    resp = await ac.post(f"/shop/orders/{order.id}/cancel", json={})
    assert resp.status_code == 403


async def test_cancel_order_twice_returns_409(db_session, authed_client_factory) -> None:
    owner = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(owner)
    first = await ac.post(f"/shop/orders/{order.id}/cancel", json={"reason": "不需要了"})
    assert first.status_code == 200
    assert first.json()["status"] == "cancelled"

    second = await ac.post(f"/shop/orders/{order.id}/cancel", json={})
    assert second.status_code == 409


@pytest.mark.parametrize(
    ("email", "student_id", "expected"),
    [
        ("g0210001@hchs.hc.edu.tw", "210001", 403),
        ("g0210001@hchs.hc.edu.tw", "310001", 403),
        ("parent@example.test", None, 403),
        ("alumnus@example.test", "210001", 403),
        ("teacher@hchs.hc.edu.tw", None, 200),
        ("g0310001@hchs.hc.edu.tw", "310001", 200),
        ("student@example.test", "310001", 200),
    ],
)
async def test_self_registration_requires_current_student_or_teacher(
    db_session, authed_client_factory, email, student_id, expected
):
    buyer = await _bare_user(db_session, student_id=student_id)
    buyer.email = email
    product = await _make_active_product(db_session, buyer, stock=10)
    response = await authed_client_factory(buyer).put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert response.status_code == expected
    assert await db_session.scalar(select(func.count()).select_from(Order)) == (expected == 200)
    await db_session.refresh(product)
    assert product.stock_quantity == (9 if expected == 200 else 10)
    if expected == 403:
        assert "家長代訂連結" in response.json()["detail"]


async def test_anonymous_cannot_register_product(db_session, client):
    product = await _make_active_product(db_session, await _bare_user(db_session))
    response = await client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert response.status_code == 401


@pytest.mark.parametrize("prefix, expected", [("310", 200), ("210", 403)])
async def test_personal_account_uses_verified_linked_student_identity(
    db_session, authed_client_factory, prefix, expected
):
    from api.models.user_identity import UserIdentity

    buyer = await _bare_user(db_session)
    buyer.email = "personal@example.test"
    db_session.add(
        UserIdentity(
            user_id=buyer.id,
            provider="google",
            external_id=uuid.uuid4().hex,
            email=f"g0{prefix}001@hchs.hc.edu.tw",
            linked_at=datetime.now(UTC),
        )
    )
    product = await _make_active_product(db_session, buyer)
    response = await authed_client_factory(buyer).put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert response.status_code == expected


async def test_anonymous_cannot_cancel_order(db_session, client):
    order = await _seed_order(db_session, await _bare_user(db_session))
    response = await client.post(f"/shop/orders/{order.id}/cancel", json={})
    assert response.status_code == 401


async def test_external_admin_cannot_bypass_purchase_identity(
    db_session, admin_user, authed_client_factory
):
    product = await _make_active_product(db_session, admin_user)
    response = await authed_client_factory(admin_user).put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert response.status_code == 403


@pytest.mark.parametrize("email", ["parent@example.test", "g0210001@hchs.hc.edu.tw"])
async def test_class_assistance_cannot_bypass_purchase_identity(
    db_session, authed_client_factory, email
):
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session)
    buyer.email = email
    await class_svc.add_manual_member(
        db_session, sc, data=ClassManualMemberCreate(user_id=buyer.id)
    )
    product = await _make_active_product(db_session, cadre, stock=10)
    ac = authed_client_factory(cadre)
    created = await ac.post(
        "/shop/orders/class",
        json={"user_id": str(buyer.id), "items": [{"product_id": str(product.id), "quantity": 1}]},
    )
    assert created.status_code == 403
    updated = await ac.put(
        f"/shop/orders/class/members/{buyer.id}/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert updated.status_code == 403
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0
    await db_session.refresh(product)
    assert product.stock_quantity == 10


@pytest.mark.parametrize(
    "code", ["shop:view_all", "finance:view", "shop:manage_orders", "shop:manage", "admin:all"]
)
async def test_cancel_order_requires_write_permission(db_session, authed_client_factory, code):
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, code)
    owner = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)
    response = await authed_client_factory(manager).post(
        f"/shop/orders/{order.id}/cancel", json={"reason": "不符訂購資格"}
    )
    assert response.status_code == (403 if code in {"shop:view_all", "finance:view"} else 200)


async def test_manager_can_cancel_closed_alumni_order_and_restore_stock(
    db_session, authed_client_factory
):
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    product = await _make_active_product(db_session, manager, stock=2)
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=None,
        data=ClassOrderUpsert(
            user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=2)]
        ),
    )
    order = orders[0]
    buyer.email = "g0210001@hchs.hc.edu.tw"
    buyer.student_id = "210001"
    product.sale_end = datetime.now(UTC) - timedelta(days=1)
    await db_session.flush()
    owner_cancel = await authed_client_factory(buyer).post(
        f"/shop/orders/{order.id}/cancel", json={}
    )
    assert owner_cancel.status_code == 409
    ac = authed_client_factory(manager)
    response = await ac.post(f"/shop/orders/{order.id}/cancel", json={"reason": "非在校生"})
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert "非在校生" in response.json()["notes"]
    await db_session.refresh(product)
    assert product.stock_quantity == 2
    assert product.status == "active"
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order.id))
    assert receivable.status == "canceled"
    repeated = await ac.post(f"/shop/orders/{order.id}/cancel", json={})
    assert repeated.status_code == 409
    await db_session.refresh(product)
    assert product.stock_quantity == 2


async def test_class_cadre_can_cancel_after_class_order_closure(db_session, authed_client_factory):
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    buyer = await _bare_user(db_session, student_id="11520")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    product = await _make_active_product(db_session, cadre, stock=2)
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=sc.id,
        data=ClassOrderUpsert(
            user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=1)]
        ),
    )
    order = orders[0]
    await shop_svc.close_category_for_class(
        db_session,
        category_id=product.category_id,
        class_id=sc.id,
        closed_by_id=cadre.id,
    )

    owner_cancel = await authed_client_factory(buyer).post(
        f"/shop/orders/{order.id}/cancel", json={}
    )
    cadre_cancel = await authed_client_factory(cadre).post(
        f"/shop/orders/{order.id}/cancel", json={}
    )

    assert owner_cancel.status_code == 409
    assert cadre_cancel.status_code == 200
    assert cadre_cancel.json()["status"] == "cancelled"
    await db_session.refresh(product)
    assert product.stock_quantity == 2


@pytest.mark.parametrize("flag", ["is_paid", "is_class_collected"])
async def test_manager_cannot_cancel_collected_order(
    db_session, admin_user, authed_client_factory, flag
):
    owner = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)
    setattr(order, flag, True)
    await db_session.flush()
    response = await authed_client_factory(admin_user).post(
        f"/shop/orders/{order.id}/cancel", json={}
    )
    assert response.status_code == 409
    assert "已鎖定" in response.json()["detail"]


async def test_cadre_cannot_cancel_other_class_order(db_session, authed_client_factory):
    sc = await _make_class(db_session)
    other_class = await _make_class(db_session, start="21501", end="21540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    owner = await _bare_user(db_session, student_id="21502")
    order = await _seed_order(db_session, owner, class_id=other_class.id)
    response = await authed_client_factory(cadre).post(f"/shop/orders/{order.id}/cancel", json={})
    assert response.status_code == 403


async def test_update_order_items_by_unrelated_user_returns_403(
    db_session, authed_client_factory
) -> None:
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    product = await _make_active_product(db_session, owner, price=10)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(stranger)
    resp = await ac.patch(
        f"/shop/orders/{order.id}",
        json={
            "user_id": str(owner.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert resp.status_code == 403


async def test_update_order_items_by_owner_succeeds(db_session, authed_client_factory) -> None:
    owner = await _bare_user(db_session)
    product = await _make_active_product(db_session, owner, price=10, stock=20)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(owner)
    resp = await ac.patch(
        f"/shop/orders/{order.id}",
        json={
            "user_id": str(owner.id),
            "items": [{"product_id": str(product.id), "quantity": 3}],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["total_price"] == 30


@pytest.mark.parametrize("code", ["shop:manage", "shop:manage_orders", "admin:all"])
async def test_order_manager_can_adjust_quantity_after_class_order_closes(
    db_session, authed_client_factory, code
) -> None:
    sc = await _make_class(db_session)
    buyer = await _bare_user(db_session, student_id="11520")
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, code)
    product = await _make_active_product(db_session, manager, price=100, stock=10)
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=sc.id,
        data=ClassOrderUpsert(
            user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=2)]
        ),
    )
    order = orders[0]
    item = order.items[0]
    product.price = 999
    await shop_svc.close_category_for_class(
        db_session,
        category_id=product.category_id,
        class_id=sc.id,
        closed_by_id=manager.id,
    )

    response = await authed_client_factory(manager).patch(
        f"/shop/orders/{order.id}/items/{item.id}", json={"quantity": 3}
    )

    assert response.status_code == 200
    assert response.json()["total_price"] == 300
    assert response.json()["items"][0]["quantity"] == 3
    assert response.json()["items"][0]["unit_price"] == 100
    await db_session.refresh(product)
    assert product.stock_quantity == 7


@pytest.mark.parametrize("flag", ["is_paid", "is_class_collected"])
async def test_order_manager_cannot_adjust_quantity_after_collection(
    db_session, authed_client_factory, flag
) -> None:
    buyer = await _bare_user(db_session, student_id="11520")
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    product = await _make_active_product(db_session, manager, stock=10)
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=None,
        data=ClassOrderUpsert(
            user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=1)]
        ),
    )
    order = orders[0]
    setattr(order, flag, True)
    await db_session.flush()

    response = await authed_client_factory(manager).patch(
        f"/shop/orders/{order.id}/items/{order.items[0].id}", json={"quantity": 2}
    )

    assert response.status_code == 409
    await db_session.refresh(product)
    assert product.stock_quantity == 9


async def test_unrelated_user_cannot_adjust_order_item_quantity(
    db_session, authed_client_factory
) -> None:
    buyer = await _bare_user(db_session, student_id="11520")
    stranger = await _bare_user(db_session)
    product = await _make_active_product(db_session, stranger, stock=10)
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=None,
        data=ClassOrderUpsert(
            user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=1)]
        ),
    )
    order = orders[0]
    response = await authed_client_factory(stranger).patch(
        f"/shop/orders/{order.id}/items/{order.items[0].id}", json={"quantity": 2}
    )
    assert response.status_code == 404
    await db_session.refresh(product)
    assert product.stock_quantity == 9


async def test_update_order_payment_by_unrelated_user_returns_403(
    db_session, authed_client_factory
) -> None:
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(stranger)
    resp = await ac.patch(f"/shop/orders/{order.id}/payment", json={"is_paid": True})
    assert resp.status_code == 403


async def test_class_cadre_collection_does_not_confirm_council_payment(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    owner = await _bare_user(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    order = await _seed_order(db_session, owner, class_id=sc.id)

    ac = authed_client_factory(cadre)
    resp = await ac.patch(f"/shop/orders/{order.id}/collection", json={"is_class_collected": True})
    assert resp.status_code == 200
    assert resp.json()["is_class_collected"] is True
    assert resp.json()["is_paid"] is False

    official = await ac.patch(f"/shop/orders/{order.id}/payment", json={"is_paid": True})
    assert official.status_code == 403
    class_payment = await ac.patch(f"/shop/orders/classes/{sc.id}/payment", json={"is_paid": True})
    assert class_payment.status_code == 403


async def test_council_can_confirm_whole_class_without_changing_cadre_notes(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    first = await _seed_order(db_session, buyer, class_id=sc.id, total_price=100)
    second = await _seed_order(db_session, buyer, class_id=sc.id, total_price=200)
    await shop_svc.set_class_collected(db_session, first, collected=True, actor_id=buyer.id)

    ac = authed_client_factory(manager)
    response = await ac.patch(
        f"/shop/orders/classes/{sc.id}/payment",
        json={"is_paid": True, "activity_id": None},
    )
    assert response.status_code == 200
    assert response.json()["updated_orders"] == 2
    assert first.is_paid is True and second.is_paid is True
    assert first.is_class_collected is True and second.is_class_collected is False


async def test_class_payment_report_summarizes_confirmed_valid_orders(
    db_session: AsyncSession, authed_client_factory
) -> None:
    school_class = await _make_class(db_session)
    first_class = await _make_class(db_session, start="11601", end="11640")
    second_class = await _make_class(db_session, start="11701", end="11740")
    school_class.grade = 2
    school_class.class_code = "c03"
    first_class.grade = 1
    first_class.class_code = "c02"
    second_class.grade = 1
    second_class.class_code = "c01"
    await db_session.flush()
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    await _seed_order(db_session, buyer, class_id=school_class.id, total_price=100)
    await _seed_order(db_session, buyer, class_id=first_class.id, total_price=50)
    await _seed_order(db_session, buyer, class_id=second_class.id, total_price=25)
    cancelled_order = await _seed_order(
        db_session, buyer, class_id=school_class.id, total_price=200
    )

    client = authed_client_factory(manager)
    first_confirmed = await client.patch(
        f"/shop/orders/classes/{first_class.id}/payment",
        json={"is_paid": True, "activity_id": None},
    )
    assert first_confirmed.status_code == 200
    second_confirmed = await client.patch(
        f"/shop/orders/classes/{second_class.id}/payment",
        json={"is_paid": True, "activity_id": None},
    )
    assert second_confirmed.status_code == 200
    confirmed = await client.patch(
        f"/shop/orders/classes/{school_class.id}/payment",
        json={"is_paid": True, "activity_id": None},
    )
    assert confirmed.status_code == 200
    cancelled_order.status = OrderStatus.CANCELLED
    await db_session.flush()

    response = await client.get("/shop/orders/class-payments")

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 3
    assert [row["class_id"] for row in rows] == [
        str(second_class.id),
        str(first_class.id),
        str(school_class.id),
    ]
    assert rows[0]["class_label"] == class_svc.class_display_label(second_class)
    assert rows[0]["grade"] == 1
    assert rows[0]["record_id"]
    assert rows[0]["collection_type"] == "class"
    assert rows[0]["activity_id"] is None
    assert rows[0]["activity_label"] == "一般商品"
    assert rows[0]["confirmed_at"] is not None
    assert rows[0]["amount"] == 25
    assert rows[0]["order_count"] == 1
    assert rows[1]["class_label"] == class_svc.class_display_label(first_class)
    assert rows[1]["grade"] == 1
    assert rows[1]["amount"] == 50
    assert rows[2]["class_label"] == class_svc.class_display_label(school_class)
    assert rows[2]["grade"] == 2
    assert rows[2]["amount"] == 100


async def test_class_payment_report_requires_global_shop_read_permission(
    db_session: AsyncSession, client, authed_client_factory
) -> None:
    viewer = await _bare_user(db_session)

    assert (await client.get("/shop/orders/class-payments")).status_code == 401
    assert (
        await authed_client_factory(viewer).get("/shop/orders/class-payments")
    ).status_code == 403


async def test_council_class_payment_emails_cadres_full_class_orders_once(
    db_session, authed_client_factory
) -> None:
    school_class = await _make_class(db_session)
    other_class = await _make_class(db_session, start="21501", end="21540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, school_class, user_id=cadre.id)
    manager = await _bare_user(db_session)
    buyer_one = await _bare_user(db_session, student_id="11510")
    buyer_two = await _bare_user(db_session, student_id="11511")
    outsider = await _bare_user(db_session, student_id="21510")
    activity = Activity(name="校慶商品", status=ActivityStatus.ACTIVE)
    other_activity = Activity(name="其他活動", status=ActivityStatus.ACTIVE)
    db_session.add_all([activity, other_activity])
    await db_session.flush()
    product = await _make_active_product(db_session, manager, price=50)
    product.name = "紀念衫"

    collected = await _seed_order(
        db_session,
        buyer_one,
        class_id=school_class.id,
        total_price=100,
        is_class_collected=True,
    )
    collected.activity_id = activity.id
    db_session.add(
        OrderItem(
            order_id=collected.id,
            product_id=product.id,
            quantity=2,
            unit_price=50,
            selected_options=[{"group_name": "尺寸", "value": "M"}],
        )
    )
    not_collected = await _seed_order(
        db_session, buyer_two, class_id=school_class.id, total_price=150
    )
    not_collected.activity_id = activity.id
    db_session.add(
        OrderItem(
            order_id=not_collected.id,
            product_id=product.id,
            quantity=3,
            unit_price=50,
        )
    )
    another_activity_order = await _seed_order(
        db_session, buyer_two, class_id=school_class.id, total_price=900
    )
    another_activity_order.activity_id = other_activity.id
    another_class_order = await _seed_order(
        db_session, outsider, class_id=other_class.id, total_price=800
    )
    another_class_order.activity_id = activity.id
    await _grant_permission(db_session, manager, "shop:manage_orders")
    await db_session.flush()

    ac = authed_client_factory(manager)
    path = f"/shop/orders/classes/{school_class.id}/payment"
    payload = {"is_paid": True, "activity_id": str(activity.id)}
    response = await ac.patch(path, json=payload)
    assert response.status_code == 200
    assert response.json()["updated_orders"] == 2
    assert collected.is_paid is True and not_collected.is_paid is True
    assert another_activity_order.is_paid is False and another_class_order.is_paid is False

    confirmation = await db_session.scalar(
        select(OutboxEvent).where(OutboxEvent.event_type == "shop.class_payment_confirmed")
    )
    assert confirmation is not None
    assert confirmation.payload["cadre_emails"] == [cadre.email]
    assert confirmation.payload["class_label"] == (
        f"{school_class.academic_year} 學年度 {school_class.class_code} 班"
    )
    assert confirmation.payload["activity_name"] == "校慶商品"
    orders_by_serial = {item["serial_number"]: item for item in confirmation.payload["orders"]}
    assert set(orders_by_serial) == {collected.serial_number, not_collected.serial_number}
    first_details = orders_by_serial[collected.serial_number]
    assert first_details["student_name"] == buyer_one.display_name
    assert first_details["student_id"] == buyer_one.student_id
    assert first_details["total_price"] == 100
    assert first_details["is_class_collected"] is True
    assert first_details["items"][0]["product_name"] == "紀念衫"
    assert first_details["items"][0]["selected_options"] == [{"group_name": "尺寸", "value": "M"}]
    assert orders_by_serial[not_collected.serial_number]["is_class_collected"] is False
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "shop.order_confirmed")
        )
        == 0
    )

    repeated = await ac.patch(path, json=payload)
    assert repeated.status_code == 200
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "shop.class_payment_confirmed")
        )
        == 1
    )


# ── 班級幹部檢視 ──────────────────────────────────────────────────────────────


def _receipt_totals(pdf) -> list[str]:
    """讀取原表單上下兩聯的總金額儲存格，不把商品單價誤認為合計。"""
    totals = []

    def visit(text, cm, tm, _font, _size):
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        top = 792 - (tm[4] * cm[1] + tm[5] * cm[3] + cm[5])
        if text.strip() and 302 < x < 410 and (320 < top < 345 or 665 < top < 691):
            totals.append(text.strip())

    for page in pdf.pages:
        page.extract_text(visitor_text=visit)
    return totals


@pytest.mark.parametrize("permission", [None, "shop:view_all", "class:shop_collect"])
async def test_class_receipt_rejects_users_without_shop_manage_permission(
    db_session, client, authed_client_factory, permission
) -> None:
    sc = await _make_class(db_session)
    url = f"/shop/orders/classes/{sc.id}/receipt.pdf"
    assert (await client.get(url)).status_code == 401
    user = await _bare_user(db_session)
    if permission:
        await _grant_permission(db_session, user, permission)
    ac = authed_client_factory(user)
    assert (await ac.get(url)).status_code == 403
    assert (
        await ac.post(
            "/shop/orders/classes/receipts.pdf",
            json={"activity_id": None, "class_ids": [str(sc.id)]},
        )
    ).status_code == 403
    assert (
        await client.post("/shop/orders/receipts/changed.pdf", json={"activity_id": None})
    ).status_code == 401
    assert (
        await ac.post("/shop/orders/receipts/changed.pdf", json={"activity_id": None})
    ).status_code == 403


async def test_class_receipt_contains_all_active_orders_in_class_and_activity(
    db_session, authed_client_factory, monkeypatch
) -> None:
    from io import BytesIO

    from pypdf import PdfReader

    from api.services.shop import _receipts

    monkeypatch.setattr(_receipts, "local_today", lambda: date(2026, 10, 21))
    sc = await _make_class(db_session)
    other_class = await _make_class(db_session, start="21501", end="21540")
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    activity = Activity(name="校慶預購", status=ActivityStatus.ACTIVE)
    other_activity = Activity(name="其他活動", status=ActivityStatus.ACTIVE)
    db_session.add_all([activity, other_activity])
    await db_session.flush()
    product = await _make_active_product(db_session, manager, price=999)
    product.name = "紀念衫"
    for quantity, amount, is_paid in [(3, 270, True), (1, 100, False)]:
        order = await _seed_order(
            db_session, buyer, class_id=sc.id, total_price=amount, is_paid=is_paid
        )
        order.activity_id = activity.id
        order.subtotal_price = quantity * 100
        order.discount_amount = quantity * 100 - amount
        db_session.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                quantity=quantity,
                unit_price=100,
                selected_options=[{"group_name": "尺寸", "value": "L"}],
            )
        )
    # 取消、退款、其他活動、一般商品，以及另一班均不得列入。
    for class_id, activity_id, paid, order_status in [
        (sc.id, activity.id, True, OrderStatus.CANCELLED),
        (sc.id, activity.id, True, OrderStatus.REFUNDED),
        (sc.id, other_activity.id, True, OrderStatus.PENDING),
        (sc.id, None, True, OrderStatus.PENDING),
        (other_class.id, activity.id, True, OrderStatus.PENDING),
    ]:
        excluded = await _seed_order(
            db_session, buyer, class_id=class_id, total_price=9999, is_paid=paid
        )
        excluded.activity_id = activity_id
        excluded.status = order_status
    await db_session.flush()

    response = await authed_client_factory(manager).get(
        f"/shop/orders/classes/{sc.id}/receipt.pdf", params={"activity_id": str(activity.id)}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["cache-control"] == "no-store"
    assert "filename*=UTF-8''" in response.headers["content-disposition"]
    pdf = PdfReader(BytesIO(response.content))
    assert len(pdf.pages) == 1
    assert tuple(pdf.pages[0].mediabox) == (0, 0, 612, 792)
    text = "".join(page.extract_text() for page in pdf.pages)
    assert "收執聯" in text and "存根聯" in text
    assert _receipt_totals(pdf) == ["370", "370"]
    assert text.count("400") == 2
    assert text.count("優惠折抵") == 2
    assert sum(line.strip() == "優惠折抵 -30" for line in text.splitlines()) == 2
    assert text.count("尺寸：L") == 2
    assert text.count("紀念衫") == 2  # 相同規格與成交單價已合併。
    date_fields = []

    def visit_date(value, cm, tm, _font, _size):
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        top = 792 - (tm[4] * cm[1] + tm[5] * cm[3] + cm[5])
        if (
            value.strip() in {"115", "10", "21"}
            and 120 < x < 216
            and (115 < top < 129 or 460 < top < 475)
        ):
            date_fields.append(value.strip())

    pdf.pages[0].extract_text(visitor_text=visit_date)
    assert date_fields == ["115", "10", "21", "115", "10", "21"]
    assert "繳款人簽名" not in text and "班聯收款人簽名" not in text
    assert "9,999" not in text


async def test_class_receipt_download_does_not_require_or_mark_paid(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage")
    order = await _seed_order(db_session, buyer, class_id=sc.id, is_class_collected=True)
    response = await authed_client_factory(manager).get(f"/shop/orders/classes/{sc.id}/receipt.pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    await db_session.refresh(order)
    assert order.is_paid is False and order.is_class_collected is True


async def test_class_receipt_batch_combines_selected_classes_and_all_classes(
    db_session, authed_client_factory
) -> None:
    from io import BytesIO

    from pypdf import PdfReader

    classes = [
        await _make_class(db_session),
        await _make_class(db_session, start="21501", end="21540"),
        await _make_class(db_session, start="31501", end="31540"),
    ]
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    activity = Activity(name="批次收據活動", status=ActivityStatus.ACTIVE)
    other_activity = Activity(name="其他活動", status=ActivityStatus.ACTIVE)
    db_session.add_all([activity, other_activity])
    await db_session.flush()
    for school_class, amount, is_paid in zip(
        classes, (100, 200, 300), (False, True, False), strict=True
    ):
        order = await _seed_order(
            db_session, buyer, class_id=school_class.id, total_price=amount, is_paid=is_paid
        )
        order.activity_id = activity.id
    other_order = await _seed_order(db_session, buyer, class_id=classes[2].id, total_price=900)
    other_order.activity_id = other_activity.id
    personal_order = await _seed_order(db_session, buyer, total_price=50)
    personal_order.activity_id = activity.id
    product = await _make_active_product(db_session, manager, price=50)
    db_session.add(
        OrderItem(order_id=personal_order.id, product_id=product.id, quantity=1, unit_price=50)
    )
    await db_session.flush()
    ac = authed_client_factory(manager)

    selected_response = await ac.post(
        "/shop/orders/classes/receipts.pdf",
        json={"activity_id": str(activity.id), "class_ids": [str(item.id) for item in classes[:2]]},
    )
    assert selected_response.status_code == 200
    selected_pdf = PdfReader(BytesIO(selected_response.content))
    selected_text = "".join(page.extract_text() for page in selected_pdf.pages)
    assert len(selected_pdf.pages) == 2
    assert classes[0].class_code in selected_text and classes[1].class_code in selected_text
    assert classes[2].class_code not in selected_text
    assert "900" not in selected_text
    assert sorted(_receipt_totals(selected_pdf)) == ["100", "100", "200", "200"]

    confirmed = await ac.patch(
        f"/shop/orders/classes/{classes[1].id}/payment",
        json={"is_paid": True, "activity_id": str(activity.id)},
    )
    assert confirmed.status_code == 200
    all_response = await ac.post(
        "/shop/orders/classes/receipts.pdf",
        json={"activity_id": str(activity.id), "unpaid_only": True},
    )
    assert all_response.status_code == 200
    all_pdf = PdfReader(BytesIO(all_response.content))
    all_text = "".join(page.extract_text() for page in all_pdf.pages)
    assert len(all_pdf.pages) == 3
    assert classes[0].class_code in all_text and classes[2].class_code in all_text
    assert classes[1].class_code not in all_text
    assert "900" not in all_text
    assert personal_order.serial_number in "".join(all_text.split())
    assert sorted(_receipt_totals(all_pdf)) == ["100", "100", "300", "300", "50", "50"]


async def test_receipt_batch_and_changed_downloads_scope_to_product_topic(
    db_session, authed_client_factory, monkeypatch
) -> None:
    from io import BytesIO

    from pypdf import PdfReader

    from api.services.shop import _receipts

    school_class = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    activity = Activity(name="同活動", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    topic_a = await _make_category(db_session, manager, activity_id=activity.id, name="主題甲")
    topic_b = await _make_category(db_session, manager, activity_id=activity.id, name="主題乙")
    products = [
        await _make_active_product(db_session, manager, price=100, category=topic_a),
        await _make_active_product(db_session, manager, price=200, category=topic_b),
    ]
    orders = [
        await _seed_order(db_session, buyer, class_id=school_class.id, total_price=amount)
        for amount in (100, 200)
    ]
    for order, topic, product in zip(orders, (topic_a, topic_b), products, strict=True):
        order.activity_id = activity.id
        order.category_id = topic.id
        db_session.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                quantity=1,
                unit_price=order.total_price,
                selected_options=[],
            )
        )
    await db_session.flush()

    client = authed_client_factory(manager)
    batch = await client.post(
        "/shop/orders/classes/receipts.pdf",
        json={"category_id": str(topic_a.id), "class_ids": [str(school_class.id)]},
    )
    assert batch.status_code == 200, batch.text
    batch_pdf = PdfReader(BytesIO(batch.content))
    batch_text = "".join(page.extract_text() for page in batch_pdf.pages)
    assert "主題甲" in batch_text and "主題乙" not in batch_text
    assert _receipt_totals(batch_pdf) == ["100", "100"]

    first_print = datetime.now(UTC) + timedelta(seconds=1)
    monkeypatch.setattr(_receipts, "now_local", lambda: first_print)
    orders[0].total_price = 125
    orders[0].updated_at = first_print + timedelta(seconds=1)
    await db_session.flush()
    changed = await client.post(
        "/shop/orders/receipts/changed.pdf", json={"category_id": str(topic_a.id)}
    )
    assert changed.status_code == 200, changed.text
    changed_pdf = PdfReader(BytesIO(changed.content))
    changed_text = "".join(page.extract_text() for page in changed_pdf.pages)
    assert "主題甲" in changed_text and "主題乙" not in changed_text
    assert _receipt_totals(changed_pdf) == ["125", "125"]


@pytest.mark.parametrize("with_activity", [False, True])
async def test_unpaid_receipts_include_individual_and_supplement_orders_without_classes(
    db_session, authed_client_factory, client, with_activity
) -> None:
    from io import BytesIO

    from pypdf import PdfReader

    from api.models.shop_order_receipt_print import ShopOrderReceiptPrint

    school_class = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    activity = Activity(name="個人收據活動", status=ActivityStatus.ACTIVE)
    other_activity = Activity(name="排除活動", status=ActivityStatus.ACTIVE)
    db_session.add_all([activity, other_activity])
    await db_session.flush()
    activity_id = activity.id if with_activity else None
    personal = await _seed_order(db_session, buyer, total_price=70)
    supplement = await _seed_order(db_session, buyer, total_price=60, is_class_collected=True)
    supplement.supplement_class_id = school_class.id
    for order in (personal, supplement):
        order.activity_id = activity_id
    excluded = []
    for amount, status, is_paid in (
        (80, OrderStatus.PENDING, True),
        (90, OrderStatus.CANCELLED, False),
        (91, OrderStatus.REFUNDED, False),
    ):
        order = await _seed_order(db_session, buyer, total_price=amount, is_paid=is_paid)
        order.activity_id = activity_id
        order.status = status
        excluded.append(order)
    outside_scope = await _seed_order(db_session, buyer, total_price=92)
    outside_scope.activity_id = other_activity.id
    test_product = await _make_active_product(db_session, manager)
    for order in (personal, supplement, *excluded):
        db_session.add(
            OrderItem(
                order_id=order.id,
                product_id=test_product.id,
                quantity=1,
                unit_price=order.total_price,
            )
        )
    test_order = await _seed_order(db_session, buyer, total_price=93)
    test_order.activity_id = activity_id
    test_order.test_product_id = test_product.id
    excluded.extend([outside_scope, test_order])
    await db_session.flush()
    payload = {"activity_id": str(activity_id) if activity_id else None, "unpaid_only": True}
    path = "/shop/orders/classes/receipts.pdf"
    assert (await client.post(path, json=payload)).status_code == 401
    assert (await authed_client_factory(buyer).post(path, json=payload)).status_code == 403
    response = await authed_client_factory(manager).post(path, json=payload)
    assert response.status_code == 200, response.text
    pdf = PdfReader(BytesIO(response.content))
    text = "".join(page.extract_text() for page in pdf.pages)
    compact_text = "".join(text.split())
    assert len(pdf.pages) == 2
    assert personal.serial_number in compact_text and supplement.serial_number in compact_text
    assert "補收款" in text
    assert sorted(_receipt_totals(pdf)) == ["60", "60", "70", "70"]
    for order in excluded:
        assert order.serial_number not in compact_text
        assert await db_session.get(ShopOrderReceiptPrint, order.id) is None
    for order in (personal, supplement):
        await db_session.refresh(order)
        assert order.is_paid is False and order.class_id is None
        assert await db_session.get(ShopOrderReceiptPrint, order.id) is not None
    assert supplement.supplement_class_id == school_class.id
    assert supplement.is_class_collected is True
    # 相同內容已由批次列印記錄，不應再出現在增量列印。
    unchanged = await authed_client_factory(manager).post(
        "/shop/orders/receipts/changed.pdf", json={"activity_id": payload["activity_id"]}
    )
    # 已繳費個人單尚未列印，仍應由增量列印正常列出。
    assert unchanged.status_code == 200
    changed_text = "".join(
        page.extract_text() for page in PdfReader(BytesIO(unchanged.content)).pages
    )
    compact_changed_text = "".join(changed_text.split())
    assert excluded[0].serial_number in compact_changed_text
    assert personal.serial_number not in compact_changed_text
    assert supplement.serial_number not in compact_changed_text


async def test_changed_receipts_include_unpaid_supplements(db_session, authed_client_factory):
    from io import BytesIO

    from pypdf import PdfReader

    school_class = await _make_class(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    order = await _seed_order(db_session, manager, total_price=60)
    order.supplement_class_id = school_class.id
    product = await _make_active_product(db_session, manager, price=60)
    db_session.add(OrderItem(order_id=order.id, product_id=product.id, quantity=1, unit_price=60))
    await db_session.flush()
    ac = authed_client_factory(manager)
    response = await ac.post("/shop/orders/receipts/changed.pdf", json={"activity_id": None})
    assert response.status_code == 200, response.text
    text = "".join(page.extract_text() for page in PdfReader(BytesIO(response.content)).pages)
    assert order.serial_number in "".join(text.split()) and "補收款" in text
    await db_session.refresh(order)
    assert order.is_paid is False and order.class_id is None
    assert order.supplement_class_id == school_class.id


async def test_changed_receipts_print_only_updated_classes_and_individual_orders(
    db_session, authed_client_factory, monkeypatch
) -> None:
    from io import BytesIO

    from pypdf import PdfReader

    from api.services.shop import _receipts

    classes = [
        await _make_class(db_session),
        await _make_class(db_session, start="21501", end="21540"),
    ]
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    activity = Activity(name="增量收據活動", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    class_orders = [
        await _seed_order(db_session, buyer, class_id=classes[0].id, total_price=100),
        await _seed_order(db_session, buyer, class_id=classes[1].id, total_price=200),
    ]
    for order in class_orders:
        order.activity_id = activity.id
    personal_order = await _seed_order(db_session, buyer, total_price=50)
    personal_order.activity_id = activity.id
    await db_session.flush()

    first_print = datetime.now(UTC) + timedelta(seconds=1)
    monkeypatch.setattr(_receipts, "now_local", lambda: first_print)
    client = authed_client_factory(manager)
    initial = await client.post(
        "/shop/orders/classes/receipts.pdf",
        json={"activity_id": str(activity.id), "unpaid_only": True},
    )
    assert initial.status_code == 200
    initial_text = "".join(
        page.extract_text() for page in PdfReader(BytesIO(initial.content)).pages
    )
    assert classes[0].class_code in initial_text and classes[1].class_code in initial_text

    class_orders[0].total_price = 125
    class_orders[0].updated_at = first_print + timedelta(seconds=1)
    personal_order.updated_at = first_print + timedelta(seconds=1)
    await db_session.flush()
    monkeypatch.setattr(_receipts, "now_local", lambda: first_print + timedelta(seconds=2))

    changed = await client.post(
        "/shop/orders/receipts/changed.pdf", json={"activity_id": str(activity.id)}
    )
    assert changed.status_code == 200, changed.text
    changed_text = "".join(
        page.extract_text() for page in PdfReader(BytesIO(changed.content)).pages
    )
    assert classes[0].class_code in changed_text
    assert classes[1].class_code not in changed_text
    assert changed_text.count("測試使用者") == 2
    assert "列印時間：" in changed_text

    unchanged = await client.post(
        "/shop/orders/receipts/changed.pdf", json={"activity_id": str(activity.id)}
    )
    assert unchanged.status_code == 400
    assert unchanged.json()["detail"] == "上次列印後沒有變更的有效訂單"


async def test_class_receipt_missing_class_and_activity(db_session, authed_client_factory) -> None:
    sc = await _make_class(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "admin:all")
    ac = authed_client_factory(manager)
    assert (await ac.get(f"/shop/orders/classes/{uuid.uuid4()}/receipt.pdf")).status_code == 404
    missing_activity = await ac.get(
        f"/shop/orders/classes/{sc.id}/receipt.pdf", params={"activity_id": str(uuid.uuid4())}
    )
    assert missing_activity.status_code == 400
    assert missing_activity.json()["detail"] == "找不到此活動"


async def test_class_receipt_without_activity_includes_only_general_goods(
    db_session, admin_user, authed_client_factory
) -> None:
    from io import BytesIO

    from pypdf import PdfReader

    sc = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    product = await _make_active_product(db_session, admin_user, price=100)
    order = await _seed_order(db_session, buyer, class_id=sc.id, total_price=100, is_paid=True)
    db_session.add(OrderItem(order_id=order.id, product_id=product.id, quantity=1, unit_price=100))
    activity = Activity(name="其他活動", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    excluded = await _seed_order(db_session, buyer, class_id=sc.id, total_price=9999, is_paid=True)
    excluded.activity_id = activity.id
    await db_session.flush()
    response = await authed_client_factory(admin_user).get(
        f"/shop/orders/classes/{sc.id}/receipt.pdf"
    )
    assert response.status_code == 200
    pdf = PdfReader(BytesIO(response.content))
    text = "".join(page.extract_text() for page in pdf.pages)
    assert "一般商品" not in text
    assert _receipt_totals(pdf) == ["100", "100"]
    assert "9,999" not in text

    batch_response = await authed_client_factory(admin_user).post(
        "/shop/orders/classes/receipts.pdf",
        json={"activity_id": None, "class_ids": [str(sc.id)]},
    )
    assert batch_response.status_code == 200
    batch_pdf = PdfReader(BytesIO(batch_response.content))
    assert len(batch_pdf.pages) == 1
    assert "一般商品" not in batch_pdf.pages[0].extract_text()


async def _add_person_class_member(db, user, school_class):
    person = await person_svc.ensure_person_for_user(db, user)
    return await person_svc.create_affiliation(
        db,
        data=PersonAffiliationCreate(
            person_id=person.id,
            kind=PersonAffiliationKind.CLASS_MEMBER,
            class_id=school_class.id,
        ),
    )


async def test_person_class_member_self_order_is_visible_to_cadre(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session)
    await _add_person_class_member(db_session, buyer, sc)
    product = await _make_active_product(db_session, cadre, price=40)

    buyer_client = authed_client_factory(buyer)
    created = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"quantity": 2, "option_ids": []}]},
    )
    assert created.status_code == 200
    assert created.json()["class_id"] == str(sc.id)
    assert (await buyer_client.get("/classes/me")).json()["id"] == str(sc.id)

    ac = authed_client_factory(cadre)
    listed = await ac.get("/shop/orders/class")
    assert listed.status_code == 200
    assert [order["id"] for order in listed.json()] == [created.json()["id"]]
    summary = await ac.get("/shop/orders/class/summary")
    assert summary.status_code == 200
    assert summary.json()["order_count"] == 1
    assert summary.json()["total_amount"] == 80
    assert summary.json()["product_rows"][0]["quantity"] == 2


async def test_person_class_member_assisted_order_is_visible_and_collectable(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session)
    await _add_person_class_member(db_session, buyer, sc)
    product = await _make_active_product(db_session, cadre, price=40)

    ac = authed_client_factory(cadre)
    created = await ac.post(
        "/shop/orders/class",
        json={
            "user_id": str(buyer.id),
            "items": [{"product_id": str(product.id), "quantity": 3}],
        },
    )
    assert created.status_code == 201
    order_id = created.json()[0]["id"]
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "shop.order_confirmed")
        )
        == 0
    )
    listed = await ac.get("/shop/orders/class")
    assert listed.status_code == 200
    assert [order["id"] for order in listed.json()] == [order_id]
    collected = await ac.patch(
        f"/shop/orders/{order_id}/collection", json={"is_class_collected": True}
    )
    assert collected.status_code == 200
    confirmation = await db_session.scalar(
        select(OutboxEvent).where(OutboxEvent.event_type == "shop.order_confirmed")
    )
    assert confirmation is not None
    assert confirmation.payload["order_id"] == order_id
    assert confirmation.payload["buyer_email"] == buyer.email
    collected_again = await ac.patch(
        f"/shop/orders/{order_id}/collection", json={"is_class_collected": True}
    )
    assert collected_again.status_code == 200
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "shop.order_confirmed")
        )
        == 1
    )
    summary = await ac.get("/shop/orders/class/summary")
    assert summary.status_code == 200
    assert summary.json()["paid_amount"] == 120
    assert summary.json()["product_rows"][0]["collected_quantity"] == 3


async def test_person_class_member_unassigned_order_is_recovered_with_receivable(
    db_session, authed_client_factory, client
) -> None:
    sc = await _make_class(db_session)
    other_class = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session)
    product = await _make_active_product(db_session, cadre, price=40)
    buyer_client = authed_client_factory(buyer)
    created = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"quantity": 2, "option_ids": []}]},
    )
    assert created.status_code == 200
    assert created.json()["class_id"] is None
    order_id = uuid.UUID(created.json()["id"])
    await _add_person_class_member(db_session, buyer, sc)
    historical = await _seed_order(db_session, buyer, class_id=other_class.id)
    cancelled = await _seed_order(db_session, buyer)
    cancelled.status = OrderStatus.CANCELLED
    await db_session.flush()
    outsider = await _bare_user(db_session)
    await _add_person_class_member(db_session, outsider, other_class)
    outsider_order = await _seed_order(db_session, outsider)
    transferred = await _bare_user(db_session)
    await _add_person_class_member(db_session, transferred, sc)
    await class_svc.add_manual_member(
        db_session, other_class, data=ClassManualMemberCreate(user_id=transferred.id)
    )
    transferred_order = await _seed_order(db_session, transferred)

    assert (await client.get("/shop/orders/class")).status_code == 401
    assert (await buyer_client.get("/shop/orders/class")).json() == []
    await db_session.refresh(outsider_order)
    assert outsider_order.class_id is None

    ac = authed_client_factory(cadre)
    # Summary can be requested before the order list, as on the class workspace.
    summary = await ac.get("/shop/orders/class/summary")
    assert summary.status_code == 200
    assert summary.json()["order_count"] == 1
    assert summary.json()["total_amount"] == 80
    listed = await ac.get("/shop/orders/class")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [str(order_id)]
    assert listed.json()[0]["class_id"] == str(sc.id)
    assert listed.json()[0]["items"][0]["quantity"] == 2
    receivable = await db_session.scalar(
        select(Receivable).where(
            Receivable.source_type == ReceivableSource.SHOP_ORDER.value,
            Receivable.source_id == order_id,
        )
    )
    assert receivable.class_id == sc.id
    assert receivable.amount == 80
    assert receivable.paid_amount == 0
    await db_session.refresh(historical)
    await db_session.refresh(cancelled)
    await db_session.refresh(outsider_order)
    await db_session.refresh(transferred_order)
    assert historical.class_id == other_class.id
    assert cancelled.class_id is None
    assert outsider_order.class_id is None
    assert transferred_order.class_id is None
    collected = await ac.patch(
        f"/shop/orders/{order_id}/collection", json={"is_class_collected": True}
    )
    assert collected.status_code == 200
    assert collected.json()["is_class_collected"] is True


async def test_person_class_member_can_update_registration_without_class_assignment(
    db_session, authed_client_factory
) -> None:
    buyer = await _bare_user(db_session)
    product = await _make_active_product(db_session, buyer, price=40)
    ac = authed_client_factory(buyer)
    created = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"quantity": 1, "option_ids": []}]},
    )
    assert created.status_code == 200
    assert created.json()["class_id"] is None
    sc = await _make_class(db_session)
    await _add_person_class_member(db_session, buyer, sc)

    updated = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"quantity": 3, "option_ids": []}]},
    )
    assert updated.status_code == 200
    assert updated.json()["id"] == created.json()["id"]
    assert updated.json()["class_id"] == str(sc.id)
    assert updated.json()["total_price"] == 120


async def test_class_cadre_adjusts_member_product_total_across_orders_and_keeps_locked_quantities(
    db_session, authed_client_factory
) -> None:
    school_class = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, school_class, user_id=cadre.id)
    student = await _bare_user(db_session)
    await _add_person_class_member(db_session, student, school_class)
    product = await _make_active_product(db_session, cadre, price=40, stock=5)

    paid_order = await _seed_order(
        db_session, student, class_id=school_class.id, total_price=80, is_paid=True
    )
    await db_session.refresh(paid_order, ["items"])
    paid_order.subtotal_price = 80
    paid_order.items.append(
        OrderItem(product_id=product.id, quantity=2, unit_price=40, selected_options=[])
    )
    collected_order = await _seed_order(
        db_session, student, class_id=school_class.id, total_price=40, is_class_collected=True
    )
    await db_session.refresh(collected_order, ["items"])
    collected_order.subtotal_price = 40
    collected_order.items.append(
        OrderItem(product_id=product.id, quantity=1, unit_price=40, selected_options=[])
    )
    editable_order = await _seed_order(
        db_session, student, class_id=school_class.id, total_price=80
    )
    await db_session.refresh(editable_order, ["items"])
    editable_order.subtotal_price = 80
    editable_order.items.append(
        OrderItem(product_id=product.id, quantity=2, unit_price=40, selected_options=[])
    )
    await db_session.flush()
    ac = authed_client_factory(cadre)

    listed = await ac.get(f"/shop/orders/class/members/{student.id}/registrations")
    assert listed.status_code == 200
    assert sum(item["quantity"] for order in listed.json() for item in order["items"]) == 5

    updated = await ac.put(
        f"/shop/orders/class/members/{student.id}/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 4}]},
    )
    assert updated.status_code == 200
    by_id = {order["id"]: order for order in updated.json()}
    assert by_id[str(paid_order.id)]["items"][0]["quantity"] == 2
    assert by_id[str(collected_order.id)]["items"][0]["quantity"] == 1
    assert by_id[str(editable_order.id)]["items"][0]["quantity"] == 1
    assert sum(item["quantity"] for order in updated.json() for item in order["items"]) == 4
    await db_session.refresh(product)
    assert product.stock_quantity == 6

    locked_reduction = await ac.put(
        f"/shop/orders/class/members/{student.id}/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert locked_reduction.status_code == 422
    assert "不能減少" in locked_reduction.json()["detail"]


async def test_class_cadre_can_remove_last_unlocked_product_quantity(
    db_session, authed_client_factory
) -> None:
    school_class = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11502")
    await class_svc.add_cadre(db_session, school_class, user_id=cadre.id)
    student = await _bare_user(db_session)
    await _add_person_class_member(db_session, student, school_class)
    product = await _make_active_product(db_session, cadre, stock=3)
    order = await _seed_order(db_session, student, class_id=school_class.id, total_price=200)
    await db_session.refresh(order, ["items"])
    order.subtotal_price = 200
    order.items.append(
        OrderItem(product_id=product.id, quantity=2, unit_price=100, selected_options=[])
    )
    await db_session.flush()

    response = await authed_client_factory(cadre).put(
        f"/shop/orders/class/members/{student.id}/products/{product.id}",
        json={"variants": []},
    )

    assert response.status_code == 200
    assert response.json() == []
    await db_session.refresh(order)
    await db_session.refresh(product)
    assert order.status == OrderStatus.CANCELLED
    assert product.stock_quantity == 5


async def test_person_class_member_does_not_grant_access_to_other_class(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    other_class = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    outsider = await _bare_user(db_session)
    await _add_person_class_member(db_session, outsider, other_class)
    product = await _make_active_product(db_session, cadre, price=40)
    outside_order = await _seed_order(db_session, outsider, class_id=other_class.id)
    ac = authed_client_factory(cadre)

    created = await ac.post(
        "/shop/orders/class",
        json={
            "user_id": str(outsider.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert created.status_code == 403
    assert (
        await ac.get("/shop/orders/class", params={"member_user_id": str(outsider.id)})
    ).json() == []
    assert (
        await ac.get(f"/shop/orders/class/members/{outsider.id}/registrations")
    ).status_code == 403
    assert (
        await ac.put(
            f"/shop/orders/class/members/{outsider.id}/products/{product.id}",
            json={"variants": []},
        )
    ).status_code == 403
    collected = await ac.patch(
        f"/shop/orders/{outside_order.id}/collection", json={"is_class_collected": True}
    )
    assert collected.status_code == 403


async def test_person_class_member_keeps_existing_registration_class_snapshot(
    db_session, authed_client_factory
) -> None:
    old_class = await _make_class(db_session)
    new_class = await _make_class(db_session, start="11601", end="11640")
    buyer = await _bare_user(db_session)
    product = await _make_active_product(db_session, buyer, price=40)
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=old_class.id,
        data=ClassOrderUpsert(
            user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=1)]
        ),
    )
    await _add_person_class_member(db_session, buyer, new_class)
    updated = await authed_client_factory(buyer).put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"quantity": 3, "option_ids": []}]},
    )
    assert updated.status_code == 409
    await db_session.refresh(orders[0])
    assert orders[0].class_id == old_class.id
    assert orders[0].total_price == 40


async def test_list_class_orders_returns_only_cadre_classes(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    other_sc = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session)
    await _seed_order(db_session, buyer, class_id=sc.id)
    await _seed_order(db_session, buyer, class_id=other_sc.id)

    ac = authed_client_factory(cadre)
    resp = await ac.get("/shop/orders/class")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["class_id"] == str(sc.id)


async def test_superuser_class_orders_include_current_class_without_cadre(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    other_sc = await _make_class(db_session, start="11601", end="11640")
    superuser = await _bare_user(db_session, student_id="11501")
    superuser.is_superuser = True
    student = await _bare_user(db_session, student_id="11520")
    other_student = await _bare_user(db_session, student_id="11620")
    product = await _make_active_product(db_session, superuser, price=20)

    client = authed_client_factory(superuser)
    created = await client.post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert created.status_code == 201
    created_order_id = created.json()[0]["id"]

    await shop_svc.create_direct_order(
        db_session,
        user_id=other_student.id,
        class_id=other_sc.id,
        data=ClassOrderUpsert(
            user_id=other_student.id,
            items=[OrderItemCreate(product_id=product.id, quantity=1)],
        ),
    )

    orders = await client.get("/shop/orders/class")
    assert orders.status_code == 200
    assert [order["id"] for order in orders.json()] == [created_order_id]
    assert orders.json()[0]["class_id"] == str(sc.id)

    summary = await client.get("/shop/orders/class/summary")
    assert summary.status_code == 200
    assert summary.json()["order_count"] == 1
    assert summary.json()["total_amount"] == 20


async def test_class_order_summary_for_cadre(db_session, authed_client_factory) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session)
    order = await _seed_order(db_session, buyer, class_id=sc.id, total_price=200)
    order.is_class_collected = True

    ac = authed_client_factory(cadre)
    resp = await ac.get("/shop/orders/class/summary")
    assert resp.status_code == 200
    assert resp.json()["order_count"] == 1
    assert resp.json()["paid_amount"] == 200


async def test_class_representative_reminder_targets_require_shop_view_permission(
    client, authed_client_factory, member_user
) -> None:
    assert (
        await client.get("/shop/orders/reminder-targets/class-representatives")
    ).status_code == 401
    response = await authed_client_factory(member_user).get(
        "/shop/orders/reminder-targets/class-representatives"
    )
    assert response.status_code == 403


async def test_class_representative_reminder_targets_include_only_active_account_holders(
    db_session, authed_client_factory, admin_user
) -> None:
    active_class = await _make_class(db_session, creator=admin_user)
    active_class.label = "高一一班"
    inactive_class = await _make_class(db_session, creator=admin_user)
    inactive_class.is_active = False
    representative = await _bare_user(db_session, student_id="11501")
    inactive_representative = await _bare_user(db_session, student_id="11502")
    inactive_representative.is_active = False
    await class_svc.assign_class_role(
        db_session,
        active_class,
        role_key="class_representative",
        data=ClassRoleAssign(user_id=representative.id),
    )
    await class_svc.assign_class_role(
        db_session,
        active_class,
        role_key="class_representative",
        data=ClassRoleAssign(user_id=inactive_representative.id),
    )
    await class_svc.assign_class_role(
        db_session,
        inactive_class,
        role_key="class_representative",
        data=ClassRoleAssign(user_id=representative.id),
    )

    response = await authed_client_factory(admin_user).get(
        "/shop/orders/reminder-targets/class-representatives"
    )

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "class_id": str(active_class.id),
            "class_label": "高一一班",
            "user_id": str(representative.id),
            "user_name": representative.display_name,
        }
    ]


async def test_create_class_order_by_non_cadre_returns_403(
    db_session, authed_client_factory
) -> None:
    await _make_class(db_session, start="11501", end="11540")
    stranger = await _bare_user(db_session)
    student = await _bare_user(db_session, student_id="11510")
    product = await _make_active_product(db_session, student, price=10)

    ac = authed_client_factory(stranger)
    resp = await ac.post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert resp.status_code == 403


async def test_create_class_order_unknown_student_returns_404(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    product = await _make_active_product(db_session, cadre, price=10)

    ac = authed_client_factory(cadre)
    resp = await ac.post(
        "/shop/orders/class",
        json={
            "user_id": str(uuid.uuid4()),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert resp.status_code == 404


async def test_create_class_order_by_cadre_succeeds(db_session, authed_client_factory) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    product = await _make_active_product(db_session, cadre, price=15, stock=10)

    ac = authed_client_factory(cadre)
    resp = await ac.post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [{"product_id": str(product.id), "quantity": 2}],
        },
    )
    assert resp.status_code == 201
    orders = resp.json()
    assert orders[0]["total_price"] == 30
    assert orders[0]["assisted_by_id"] == str(cadre.id)


@pytest.mark.parametrize("has_person", [False, True])
async def test_roster_order_before_first_login_keeps_owner_and_seat(
    db_session, authed_client_factory, has_person
) -> None:
    from api.routers.auth import _upsert_google_user

    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.assign_class_role(
        db_session, sc, role_key="class_representative", data=ClassRoleAssign(user_id=cadre.id)
    )
    if has_person:
        db_session.add(Person(student_id="11520", display_name="名冊同學"))
        await db_session.flush()
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=20, student_id="11520")
    )
    product = await _make_active_product(db_session, cadre, price=15, stock=10)
    ac = authed_client_factory(cadre)
    roster = await ac.get(f"/classes/{sc.id}/members")
    assert roster.status_code == 200
    member = next(row for row in roster.json() if row["seat_number"] == 20)
    assert member["user_id"] is None
    assert member["roster_entry_id"] == str(entry.id)
    payload = {
        "roster_entry_id": str(entry.id),
        "items": [{"product_id": str(product.id), "quantity": 2}],
    }
    response = await ac.post("/shop/orders/class", json=payload)
    assert response.status_code == 201
    order = response.json()[0]
    buyer = await db_session.get(User, uuid.UUID(order["user_id"]))
    assert buyer.student_id == "11520"
    assert buyer.google_sub is None
    assert buyer.is_superuser is False
    assert buyer.is_verified is False
    assert buyer.display_name == ("名冊同學" if has_person else "20 號同學")
    assert order["class_id"] == str(sc.id)
    assert order["assisted_by_id"] == str(cadre.id)
    assert order["total_price"] == 30
    assert order["is_paid"] is False
    assert order["is_class_collected"] is False

    # 同一名冊重送給新訂單仍沿用同一帳號；首次 Google 登入也不會另建帳號。
    repeated = await ac.post("/shop/orders/class", json=payload)
    assert repeated.status_code == 201
    assert repeated.json()[0]["user_id"] == str(buyer.id)
    logged_in = await _upsert_google_user(
        db_session,
        google_sub="synthetic-roster-first-login",
        email="g011520@hchs.hc.edu.tw",
        display_name="首次登入同學",
        avatar_url=None,
        client_ip="127.0.0.1",
        user_agent="roster-order-test",
    )
    assert logged_in.id == buyer.id
    own_orders = await authed_client_factory(logged_in).get("/shop/orders")
    assert own_orders.status_code == 200
    assert order["id"] in {row["id"] for row in own_orders.json()}
    updated_roster = await ac.get(f"/classes/{sc.id}/members")
    seat_rows = [row for row in updated_roster.json() if row["student_id"] == "11520"]
    assert len(seat_rows) == 1
    assert seat_rows[0]["seat_number"] == 20
    assert seat_rows[0]["user_id"] == str(buyer.id)


@pytest.mark.parametrize("actor_kind", ["student", "other_cadre", "anonymous"])
async def test_roster_order_rejects_unauthorized_actor_without_creating_account(
    db_session, authed_client_factory, client, actor_kind
) -> None:
    sc = await _make_class(db_session)
    actor = await _bare_user(db_session, student_id="21501")
    if actor_kind == "other_cadre":
        other = await _make_class(db_session, start="21501", end="21540")
        await class_svc.add_cadre(db_session, other, user_id=actor.id)
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=20, student_id="11520")
    )
    product = await _make_active_product(db_session, actor)
    ac = client if actor_kind == "anonymous" else authed_client_factory(actor)
    response = await ac.post(
        "/shop/orders/class",
        json={
            "roster_entry_id": str(entry.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert response.status_code == (401 if actor_kind == "anonymous" else 403)
    assert await db_session.scalar(select(User.id).where(User.student_id == "11520")) is None
    assert entry.user_id is None


async def test_roster_order_cannot_bypass_manual_transfer(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    other = await _make_class(db_session, start="21501", end="21540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session, student_id="11520")
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=20, student_id="11520")
    )
    await class_svc.add_manual_member(
        db_session, other, data=ClassManualMemberCreate(user_id=buyer.id)
    )
    product = await _make_active_product(db_session, cadre)
    response = await authed_client_factory(cadre).post(
        "/shop/orders/class",
        json={
            "roster_entry_id": str(entry.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert response.status_code == 403


async def test_class_order_requires_exactly_one_recipient(
    db_session, authed_client_factory
) -> None:
    actor = await _bare_user(db_session)
    ac = authed_client_factory(actor)
    item = {"product_id": str(uuid.uuid4()), "quantity": 1}
    for recipient in ({}, {"user_id": str(actor.id), "roster_entry_id": str(uuid.uuid4())}):
        response = await ac.post("/shop/orders/class", json={**recipient, "items": [item]})
        assert response.status_code == 422
    missing = await ac.post(
        "/shop/orders/class",
        json={
            "roster_entry_id": str(uuid.uuid4()),
            "items": [item],
        },
    )
    assert missing.status_code == 404


@pytest.mark.parametrize("inactive", ["class", "student"])
async def test_roster_order_rejects_inactive_class_or_student(
    db_session, authed_client_factory, inactive
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=20, student_id="11520")
    )
    if inactive == "class":
        sc.is_active = False
    else:
        student.is_active = False
    product = await _make_active_product(db_session, cadre)
    response = await authed_client_factory(cadre).post(
        "/shop/orders/class",
        json={
            "roster_entry_id": str(entry.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert response.status_code == 403
    assert await db_session.scalar(select(func.count(Order.id))) == 0


async def test_cadre_can_register_multiple_products_in_one_request(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    category = await _make_category(db_session, cadre)
    first = await _make_active_product(db_session, cadre, category=category, price=15)
    second = await _make_active_product(db_session, cadre, category=category, price=25)

    response = await authed_client_factory(cadre).post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [
                {"product_id": str(first.id), "quantity": 2},
                {"product_id": str(second.id), "quantity": 3},
            ],
        },
    )

    assert response.status_code == 201
    orders = response.json()
    assert len(orders) == 1
    assert orders[0]["total_price"] == 105
    assert {item["product_id"]: item["quantity"] for item in orders[0]["items"]} == {
        str(first.id): 2,
        str(second.id): 3,
    }


async def test_cadre_multi_product_request_splits_activities(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    general = await _make_active_product(db_session, cadre, price=15)
    org = Org(name=f"shop-{uuid.uuid4().hex[:6]}")
    activity = Activity(name="活動商品", org=org, status=ActivityStatus.ACTIVE)
    db_session.add_all([org, activity])
    await db_session.flush()
    event_category = await _make_category(db_session, cadre, activity_id=activity.id)
    event_product = await _make_active_product(db_session, cadre, price=25, category=event_category)

    response = await authed_client_factory(cadre).post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [
                {"product_id": str(general.id), "quantity": 2},
                {"product_id": str(event_product.id), "quantity": 3},
            ],
        },
    )

    assert response.status_code == 201
    orders = response.json()
    assert len(orders) == 2
    assert {order["items"][0]["product_id"]: order["total_price"] for order in orders} == {
        str(general.id): 30,
        str(event_product.id): 75,
    }


async def test_clear_all_order_data_requires_shop_manager(
    member_user, authed_client_factory
) -> None:
    response = await authed_client_factory(member_user).delete("/shop/orders")

    assert response.status_code == 403


async def test_clear_all_order_data_requires_authentication(client) -> None:
    response = await client.delete("/shop/orders")

    assert response.status_code == 401


async def test_clear_all_order_data_removes_orders_and_restores_derived_data(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    school_class = await _make_class(db_session, start="11501", end="11540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, school_class, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    category = await _make_category(db_session, cadre)
    first = await _make_active_product(db_session, cadre, category=category, price=15, stock=20)
    second = await _make_active_product(db_session, cadre, category=category, price=25, stock=30)
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=student.id,
        class_id=school_class.id,
        data=ClassOrderUpsert(
            user_id=student.id,
            items=[
                OrderItemCreate(product_id=first.id, quantity=2),
                OrderItemCreate(product_id=second.id, quantity=3),
            ],
        ),
        assisted_by_id=cadre.id,
    )
    db_session.add(
        OutboxEvent(
            event_type="shop.order_confirmed",
            payload={"order_id": str(orders[0].id)},
            created_at=datetime.now(UTC),
        )
    )
    db_session.add(
        Receivable(
            source_type=ReceivableSource.MANUAL.value,
            user_id=student.id,
            title="保留的非商品應收款",
            amount=100,
        )
    )
    await db_session.flush()

    response = await authed_client_factory(member_user).delete("/shop/orders")

    assert response.status_code == 200
    assert response.json() == {"deleted_order_count": 1}
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0
    assert await db_session.scalar(select(func.count()).select_from(OrderItem)) == 0
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Receivable)
            .where(Receivable.source_type == ReceivableSource.SHOP_ORDER.value)
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Receivable)
            .where(Receivable.source_type == ReceivableSource.MANUAL.value)
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "shop.order_confirmed")
        )
        == 0
    )
    assert (await db_session.get(Product, first.id)).stock_quantity == 20
    assert (await db_session.get(Product, second.id)).stock_quantity == 30


# ── 後台統計 ──────────────────────────────────────────────────────────────────


async def test_order_summary_requires_permission(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders/summary")
    assert resp.status_code == 403


async def test_order_summary_with_permission_groups_by_class(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:view_all")
    sc = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    await _seed_order(db_session, buyer, class_id=sc.id, total_price=300, is_paid=True)

    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders/summary", params={"group_by": "class"})
    assert resp.status_code == 200
    assert resp.json()["total_amount"] == 300


async def test_order_quantities_requires_permission(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders/quantities")
    assert resp.status_code == 403


async def test_order_quantities_with_permission_returns_rows(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage_orders")
    product = await _make_active_product(db_session, member_user, price=10)
    buyer = await _bare_user(db_session)
    order = await _seed_order(db_session, buyer, total_price=20)
    db_session.add(OrderItem(order_id=order.id, product_id=product.id, quantity=2, unit_price=10))
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders/quantities")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["qty_total"] == 2


# ── 報表匯出 ──────────────────────────────────────────────────────────────────


async def test_export_orders_csv_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/reports/orders.csv")
    assert resp.status_code == 403


async def test_export_orders_csv_with_finance_view_permission_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "finance:view")
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/reports/orders.csv")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]


async def test_export_orders_excel_with_finance_view_permission_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "finance:view")
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/reports/orders.xlsx")
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers["content-type"]


# ── 結單管理 ──────────────────────────────────────────────────────────────────


async def test_close_category_global_by_manager_then_conflict_on_repeat(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    ac = authed_client_factory(member_user)

    first = await ac.post(f"/shop/categories/{category.id}/close", json={})
    assert first.status_code == 201
    assert first.json()["class_id"] is None

    second = await ac.post(f"/shop/categories/{category.id}/close", json={})
    assert second.status_code == 409


async def test_close_category_by_cadre_for_own_class_allowed(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    category = await _make_category(db_session, cadre)

    ac = authed_client_factory(cadre)
    resp = await ac.post(f"/shop/categories/{category.id}/close", json={"class_id": str(sc.id)})
    assert resp.status_code == 201
    assert resp.json()["class_id"] == str(sc.id)


async def test_close_category_globally_by_cadre_returns_403(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    category = await _make_category(db_session, cadre)

    ac = authed_client_factory(cadre)
    resp = await ac.post(f"/shop/categories/{category.id}/close", json={})
    assert resp.status_code == 403


async def test_close_category_by_cadre_for_other_class_returns_403(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    other_sc = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    category = await _make_category(db_session, cadre)

    ac = authed_client_factory(cadre)
    resp = await ac.post(
        f"/shop/categories/{category.id}/close", json={"class_id": str(other_sc.id)}
    )
    assert resp.status_code == 403


async def test_reopen_category_when_not_closed_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/categories/{category.id}/close")
    assert resp.status_code == 409


async def test_reopen_category_succeeds_after_close(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    ac = authed_client_factory(member_user)
    await ac.post(f"/shop/categories/{category.id}/close", json={})

    resp = await ac.delete(f"/shop/categories/{category.id}/close")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


async def test_get_close_status_reflects_closed_and_open_categories(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    closed_category = await _make_category(db_session, member_user, name="已結單")
    open_category = await _make_category(db_session, member_user, name="未結單")
    ac = authed_client_factory(member_user)
    await ac.post(f"/shop/categories/{closed_category.id}/close", json={})

    resp = await ac.get(
        "/shop/close-status",
        params={"category_ids": [str(closed_category.id), str(open_category.id)]},
    )
    assert resp.status_code == 200
    statuses = resp.json()["statuses"]
    assert statuses[str(closed_category.id)]["is_closed"] is True
    assert statuses[str(open_category.id)]["is_closed"] is False


async def test_unlinked_catalog_activities_have_independent_registrations(
    db_session, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session, student_id="11520")
    christmas = await _make_category(db_session, creator, name="聖誕傳情")
    anniversary = await _make_category(db_session, creator, name="校慶商品")
    card = await shop_svc.create_product(
        db_session,
        data=ProductCreate(
            category_id=christmas.id, name="傳情卡片餅乾套組", price=40, stock_quantity=50
        ),
        created_by=creator.id,
    )
    card = await shop_svc.activate_product(db_session, card)
    hat = await _make_active_product(db_session, creator, category=anniversary, price=994)
    second_card = await _make_active_product(db_session, creator, category=christmas, price=20)
    ac = authed_client_factory(buyer)

    async def register(product, quantity):
        response = await ac.put(
            f"/shop/registrations/current/products/{product.id}",
            json={"variants": [{"option_ids": [], "quantity": quantity}]},
        )
        assert response.status_code == 200
        return response.json()

    cards = await register(card, 3)
    hats = await register(hat, 4)
    assert cards["id"] != hats["id"]
    assert cards["category_name"] == "聖誕傳情"
    assert hats["category_name"] == "校慶商品"
    updated_cards = await register(second_card, 2)
    assert updated_cards["id"] == cards["id"]
    assert updated_cards["total_price"] == 160
    registrations = (await ac.get("/shop/registrations")).json()
    assert len(registrations) == 2
    assert sum(order["total_price"] for order in registrations) == 4136
    # Removing one activity does not remove or lock the other.
    removed = await ac.put(f"/shop/registrations/current/products/{card.id}", json={"variants": []})
    assert removed.status_code == 200
    orders = (await ac.get("/shop/orders", params={"my_only": "true"})).json()
    assert {order["category_id"] for order in orders} == {str(christmas.id), str(anniversary.id)}
    assert next(order for order in orders if order["id"] == hats["id"])["total_price"] == 3976
    cancelled = await ac.put(
        f"/shop/registrations/current/products/{second_card.id}", json={"variants": []}
    )
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["category_id"] == str(christmas.id)
    assert cancelled.json()["category_name"] == "聖誕傳情"


async def test_class_filters_unlinked_activity_and_keeps_other_classes_private(
    client, db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    other_class = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session, student_id="11520")
    outsider = await _bare_user(db_session, student_id="11620")
    first_category = await _make_category(db_session, cadre, name="聖誕傳情")
    second_category = await _make_category(db_session, cadre, name="校慶商品")
    first = await _make_active_product(db_session, cadre, category=first_category, price=40)
    second = await _make_active_product(db_session, cadre, category=second_category, price=100)
    created = await authed_client_factory(cadre).post(
        "/shop/orders/class",
        json={
            "user_id": str(buyer.id),
            "items": [
                {"product_id": str(first.id), "quantity": 3},
                {"product_id": str(second.id), "quantity": 4},
            ],
        },
    )
    assert created.status_code == 201
    assert len(created.json()) == 2
    await shop_svc.create_direct_order(
        db_session,
        user_id=outsider.id,
        class_id=other_class.id,
        data=ClassOrderUpsert(
            user_id=outsider.id, items=[OrderItemCreate(product_id=first.id, quantity=2)]
        ),
    )
    ac = authed_client_factory(cadre)
    params = {"category_id": str(first_category.id), "general_only": "true"}
    for endpoint in ("/shop/orders/class", "/shop/orders/class/summary"):
        assert (await client.get(endpoint, params=params)).status_code == 401
        # Non-cadres receive no class data, consistent with the existing read contract.
        unauthorized = await authed_client_factory(outsider).get(endpoint, params=params)
        assert unauthorized.status_code == 200
        assert unauthorized.json() == (
            []
            if endpoint.endswith("class")
            else {
                "class_count": 0,
                "order_count": 0,
                "item_count": 0,
                "total_amount": 0,
                "paid_amount": 0,
                "unpaid_amount": 0,
                "paid_order_count": 0,
                "unpaid_order_count": 0,
                "assisted_order_count": 0,
                "product_rows": [],
            }
        )
    filtered = (await ac.get("/shop/orders/class", params=params)).json()
    assert len(filtered) == 1
    assert filtered[0]["user_id"] == str(buyer.id)
    assert filtered[0]["total_price"] == 120
    summary = (await ac.get("/shop/orders/class/summary", params=params)).json()
    assert summary["total_amount"] == 120
    assert summary["item_count"] == 3
    assert [row["product_id"] for row in summary["product_rows"]] == [str(first.id)]
    assert (await ac.get("/shop/orders/class", params={"general_only": "true"})).json() == []
    assert (await ac.get("/shop/orders/class/summary", params={"general_only": "true"})).json()[
        "total_amount"
    ] == 0
    # Editing a scoped order cannot bring the other activity back into it.
    edited = await ac.patch(
        f"/shop/orders/{filtered[0]['id']}",
        json={
            "user_id": str(buyer.id),
            "items": [{"product_id": str(second.id), "quantity": 1}],
        },
    )
    assert edited.status_code == 409
    assert (await ac.get("/shop/orders/class", params=params)).json()[0]["total_price"] == 120


async def test_class_summary_activity_filter_includes_all_pages(db_session) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session, student_id="11520")
    sc = await _make_class(db_session, start="11501", end="11540")
    activity = Activity(name="校慶", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    category = await _make_category(db_session, creator, activity_id=activity.id)
    product = await _make_active_product(db_session, creator, category=category, price=10)
    for index in range(501):
        db_session.add(
            Order(
                serial_number=f"SCOPE-{uuid.uuid4().hex[:8]}-{index}",
                user_id=buyer.id,
                class_id=sc.id,
                activity_id=activity.id,
                status=OrderStatus.PENDING,
                subtotal_price=10,
                total_price=10,
                items=[
                    OrderItem(product_id=product.id, quantity=1, unit_price=10, selected_options=[])
                ],
            )
        )
    await db_session.flush()
    summary = await shop_svc.class_order_summary(
        db_session, class_ids=[sc.id], activity_id=activity.id
    )
    assert summary.order_count == 501
    assert summary.item_count == 501
    assert summary.total_amount == 5010
    assert (
        await shop_svc.class_order_summary(db_session, class_ids=[sc.id], activity_id=uuid.uuid4())
    ).order_count == 0


async def test_collected_legacy_mixed_order_cannot_be_registered_again(
    db_session, authed_client_factory
):
    buyer = await _bare_user(db_session)
    first = await _make_active_product(db_session, buyer, price=40)
    second = await _make_active_product(db_session, buyer, price=994)
    order = Order(
        serial_number="LOCKED-LEGACY",
        user_id=buyer.id,
        status=OrderStatus.PENDING,
        subtotal_price=1034,
        total_price=1034,
        is_class_collected=True,
        items=[
            OrderItem(
                product_id=product.id, quantity=1, unit_price=product.price, selected_options=[]
            )
            for product in (first, second)
        ],
    )
    db_session.add(order)
    await db_session.flush()
    response = await authed_client_factory(buyer).put(
        f"/shop/registrations/current/products/{first.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert response.status_code == 409
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    assert (await db_session.get(Product, first.id, populate_existing=True)).stock_quantity == 50


async def test_categories_linked_to_same_activity_share_registration(
    db_session, authed_client_factory
):
    buyer = await _bare_user(db_session)
    activity = Activity(name="聖誕活動", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    categories = [
        await _make_category(db_session, buyer, activity_id=activity.id, name=name)
        for name in ["餅乾", "卡片"]
    ]
    products = [await _make_active_product(db_session, buyer, category=c) for c in categories]
    ac = authed_client_factory(buyer)
    responses = [
        await ac.put(
            f"/shop/registrations/current/products/{p.id}",
            json={"variants": [{"option_ids": [], "quantity": 1}]},
        )
        for p in products
    ]
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert responses[1].json()["total_price"] == 200
    assert responses[1].json()["category_id"] is None


async def test_coupon_targets_selected_unlinked_activity(db_session, authed_client_factory):
    from api.schemas.shop import ShopPromotionCreate

    buyer = await _bare_user(db_session)
    first = await _make_active_product(db_session, buyer, price=40)
    second = await _make_active_product(db_session, buyer, price=100)
    ac = authed_client_factory(buyer)
    for product in (first, second):
        assert (
            await ac.put(
                f"/shop/registrations/current/products/{product.id}",
                json={"variants": [{"option_ids": [], "quantity": 1}]},
            )
        ).status_code == 200
    await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="傳情折抵",
            code="CARD10",
            discount_type="fixed",
            discount_value=10,
            target_product_ids=[first.id],
        ),
        created_by=buyer.id,
    )
    first = await shop_svc.get_product(db_session, first.id)
    payload = {"code": "CARD10", "category_id": str(first.series.category_id)}
    preview = await ac.post("/shop/registrations/current/promotion/preview", json=payload)
    assert preview.status_code == 200
    assert preview.json()["eligible"] is True
    applied = await ac.put("/shop/registrations/current/promotion", json=payload)
    assert applied.status_code == 200
    assert applied.json()["total_price"] == 30
    orders = (await ac.get("/shop/registrations")).json()
    assert sorted(order["total_price"] for order in orders) == [30, 100]


async def _make_testing_product(db, creator, *, category=None, stock=3, series_id=None):
    from api.services.shop._testing import start_product_testing

    category = category or await _make_category(db, creator)
    product = await shop_svc.create_product(
        db,
        data=ProductCreate(
            category_id=category.id,
            series_id=series_id,
            name="測試限定商品",
            price=100,
            stock_quantity=stock,
            sale_start=datetime.now(UTC) + timedelta(days=1),
        ),
        created_by=creator.id,
    )
    return await start_product_testing(db, product)


@pytest.mark.parametrize("kind", ["guest", "member", "manager", "tester", "superuser", "admin"])
async def test_testing_product_visibility_and_purchase_permissions(
    db_session, client, authed_client_factory, kind
):
    creator = await _bare_user(db_session)
    category = await _make_category(db_session, creator)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="測試系列")
    )
    product = await _make_testing_product(db_session, creator, category=category)
    nested = await _make_testing_product(
        db_session, creator, category=category, series_id=series.id
    )
    actor = await _bare_user(db_session)
    if kind == "superuser":
        actor.is_superuser = True
        actor.email = f"tester-{uuid.uuid4().hex}@example.net"
        await db_session.flush()
    elif kind in {"manager", "tester", "admin"}:
        await _grant_permission(
            db_session,
            actor,
            {"manager": "shop:manage", "tester": "shop:test", "admin": "admin:all"}[kind],
        )
    ac = client if kind == "guest" else authed_client_factory(actor)
    allowed = kind in {"tester", "superuser", "admin"}
    detail = await ac.get(f"/shop/products/{product.id}")
    assert detail.status_code == (200 if allowed else 404)
    if kind == "manager":
        assert (
            await ac.patch(f"/shop/products/{product.id}", json={"description": "越權"})
        ).status_code == 404
        assert (
            await ac.post(f"/shop/products/{product.id}/variant-groups", json={"name": "越權"})
        ).status_code == 404
    for url in ["/shop/products", "/shop/products?status=testing&limit=1"]:
        rows = (await ac.get(url)).json()
        assert bool(rows) is allowed
    tree = (await ac.get("/shop/catalog")).json()
    row = next(row for row in tree if row["id"] == str(category.id))
    assert [p["id"] for p in row["products"]] == ([str(product.id)] if allowed else [])
    assert [p["id"] for p in row["series"][0]["products"]] == ([str(nested.id)] if allowed else [])
    response = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert response.status_code == (200 if allowed else 401 if kind == "guest" else 403)
    await db_session.refresh(product)
    assert product.status == "testing"
    assert product.stock_quantity == (0 if allowed else 3)
    if allowed:
        assert response.json()["test_product_id"] == str(product.id)
        assert (await client.get(f"/shop/products/{product.id}")).status_code == 404
        assert not await db_session.scalar(
            select(Receivable.id).where(Receivable.source_id == uuid.UUID(response.json()["id"]))
        )
        current = (await ac.get("/shop/registrations")).json()
        assert current[0]["id"] == response.json()["id"]
        outsider = authed_client_factory(await _bare_user(db_session))
        assert (await outsider.get(f"/shop/orders/{response.json()['id']}")).status_code == 404


async def test_start_testing_requires_product_management_and_test_permission(
    db_session, client, authed_client_factory
):
    manager = await _bare_user(db_session)
    category = await _make_category(db_session, manager)
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(category_id=category.id, name="草稿", price=10),
        created_by=manager.id,
    )
    url = f"/shop/products/{product.id}/test"
    assert (await client.post(url)).status_code == 401
    ac = authed_client_factory(manager)
    await _grant_permission(db_session, manager, "shop:manage")
    assert (await ac.post(url)).status_code == 403
    tester = await _bare_user(db_session)
    await _grant_permission(db_session, tester, "shop:test")
    assert (await authed_client_factory(tester).post(url)).status_code == 403
    await _grant_permission(db_session, manager, "shop:test")
    assert (await ac.post(url)).json()["status"] == "testing"
    assert (await ac.post(url)).status_code == 409
    assert (await ac.post(f"/shop/products/{product.id}/deactivate")).status_code == 409
    assert (
        await ac.patch(f"/shop/products/{product.id}", json={"description": "可修改"})
    ).status_code == 200


async def test_launch_clears_only_product_test_orders_and_restores_stock(
    db_session, client, authed_client_factory
):
    from api.models.shop import ProductStatus, ShopOrderPromotion
    from api.schemas.shop import ShopPromotionCreate

    manager = await _bare_user(db_session)
    manager.is_superuser = True
    buyer = await _bare_user(db_session)
    cancelled_buyer = await _bare_user(db_session)
    for user in (buyer, cancelled_buyer):
        await _grant_permission(db_session, user, "shop:test")
    category = await _make_category(db_session, manager)
    regular = await _make_active_product(db_session, manager, category=category, stock=10)
    product = await _make_testing_product(db_session, manager, category=category, stock=4)
    other = await _make_testing_product(db_session, manager, category=category, stock=5)
    promotion = await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="測試優惠",
            discount_type="percentage",
            discount_value=10,
            target_product_ids=[product.id],
        ),
        created_by=manager.id,
    )
    ac = authed_client_factory(buyer)

    async def register(ac, p, quantity):
        response = await ac.put(
            f"/shop/registrations/current/products/{p.id}",
            json={
                "variants": [{"option_ids": [], "quantity": quantity}],
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    formal_order = await register(ac, regular, 2)
    other_order = await register(ac, other, 1)
    cancelled_client = authed_client_factory(cancelled_buyer)
    cancelled_order = await register(cancelled_client, product, 1)
    cancelled_response = await cancelled_client.post(
        f"/shop/orders/{cancelled_order['id']}/cancel", json={"reason": "測試取消"}
    )
    assert cancelled_response.status_code == 200
    test_order = await register(ac, product, 4)
    assert len({formal_order["id"], test_order["id"], other_order["id"]}) == 3
    test_id = uuid.UUID(test_order["id"])
    test_model = await shop_svc.get_order(db_session, test_id)
    test_model.is_paid = True
    test_model.is_class_collected = True
    db_session.add(
        Receivable(
            source_type="shop_order",
            source_id=test_id,
            title="模擬測試付款",
            amount=360,
            paid_amount=360,
            user_id=buyer.id,
        )
    )
    db_session.add(
        OutboxEvent(
            event_type="shop.order_confirmed",
            payload={"order_id": str(test_id)},
            created_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(ShopOrderPromotion)
            .where(ShopOrderPromotion.order_id == test_id)
        )
        == 1
    )
    assert (await client.get("/shop/promotions/available")).json() == []
    quantities = await shop_svc.order_quantities(db_session)
    assert {str(row.product_id) for row in quantities} == {str(regular.id)}
    from api.services.shop._export import _fetch_order_report_rows

    reports = await _fetch_order_report_rows(db_session)
    assert {row["訂單字號"] for row in reports} == {formal_order["serial_number"]}
    # 一般商品管理員沒有測試權限，不能提早公開或清除資料。
    limited_manager = await _bare_user(db_session)
    await _grant_permission(db_session, limited_manager, "shop:manage")
    launch_url = f"/shop/products/{product.id}/activate"
    assert (await authed_client_factory(limited_manager).post(launch_url)).status_code == 404
    launched = await authed_client_factory(manager).post(launch_url)
    assert launched.status_code == 200, launched.text
    assert launched.json()["status"] == "active"
    assert launched.json()["stock_quantity"] == 4
    await db_session.refresh(other)
    await db_session.refresh(regular)
    await db_session.refresh(promotion)
    assert other.stock_quantity == 4
    assert other.status == ProductStatus.TESTING
    assert regular.stock_quantity == 8
    assert promotion.used_count == 0
    assert await shop_svc.get_order(db_session, test_id) is None
    assert await shop_svc.get_order(db_session, uuid.UUID(cancelled_order["id"])) is None
    assert await shop_svc.get_order(db_session, uuid.UUID(formal_order["id"])) is not None
    assert await shop_svc.get_order(db_session, uuid.UUID(other_order["id"])) is not None
    assert (
        await db_session.scalar(select(Receivable.id).where(Receivable.source_id == test_id))
        is None
    )
    assert await db_session.scalar(select(OutboxEvent.id)) is None
    assert await db_session.scalar(select(func.count()).select_from(ShopOrderPromotion)) == 0
    assert (await client.get(f"/shop/products/{product.id}")).status_code == 200
    assert (await authed_client_factory(manager).post(launch_url)).status_code == 409
    assert (await client.get(f"/shop/products/{product.id}")).json()["stock_quantity"] == 4


async def test_testing_permission_revocation_hides_previous_registration(
    db_session, authed_client_factory
):
    from sqlalchemy import delete

    from api.core.cache import cache_invalidate_user_permissions

    user = await _bare_user(db_session)
    await _grant_permission(db_session, user, "shop:test")
    product = await _make_testing_product(db_session, user)
    ac = authed_client_factory(user)
    response = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={
            "variants": [{"option_ids": [], "quantity": 1}],
        },
    )
    assert response.status_code == 200
    await db_session.execute(delete(Permission).where(Permission.code == "shop:test"))
    await cache_invalidate_user_permissions(str(user.id))
    assert (await ac.get("/shop/registrations")).json() == []
    assert (await ac.get("/shop/orders")).json() == []
    assert (await ac.get(f"/shop/orders/{response.json()['id']}")).status_code == 404
    assert (
        await ac.put(
            f"/shop/registrations/current/products/{product.id}",
            json={
                "variants": [{"option_ids": [], "quantity": 2}],
            },
        )
    ).status_code == 403


async def test_testing_ticket_visibility_and_launch_releases_seat_holds(
    db_session, authed_client_factory
):
    from api.models.seating import Seat, SeatHold, SeatingZone

    manager = await _bare_user(db_session)
    manager.is_superuser = True
    outsider = await _bare_user(db_session)
    tester = await _bare_user(db_session)
    await _grant_permission(db_session, tester, "shop:test")
    product = await _make_testing_product(db_session, manager)
    other = await _make_testing_product(db_session, manager)
    zones = [SeatingZone(product_id=p.id, name="測試場次") for p in (product, other)]
    db_session.add_all(zones)
    await db_session.flush()
    for zone in zones:
        seat = Seat(zone_id=zone.id, label="A1", x=0, y=0)
        db_session.add(seat)
        await db_session.flush()
        db_session.add(
            SeatHold(
                seat_id=seat.id,
                zone_id=zone.id,
                user_id=tester.id,
                expires_at=datetime.now(UTC) + timedelta(minutes=10),
            )
        )
    await db_session.flush()
    outsider_client = authed_client_factory(outsider)
    for url in (
        f"/seating/products/{product.id}/zones",
        f"/seating/zones/{zones[0].id}",
        f"/seating/zones/{zones[0].id}/map",
    ):
        assert (await outsider_client.get(url)).status_code == 404
        assert (await authed_client_factory(tester).get(url)).status_code == 200
    await _grant_permission(db_session, outsider, "seating:manage")
    assert (
        await outsider_client.post(
            "/seating/zones",
            json={
                "product_id": str(product.id),
                "name": "越權場次",
            },
        )
    ).status_code == 404
    response = await authed_client_factory(manager).post(f"/shop/products/{product.id}/activate")
    assert response.status_code == 200
    assert list(await db_session.scalars(select(SeatHold.zone_id))) == [zones[1].id]


async def test_expired_product_testing_permission_does_not_grant_access(
    db_session, authed_client_factory
):
    user = await _bare_user(db_session)
    await _grant_permission(db_session, user, "shop:test")
    tenure = await db_session.scalar(select(UserPosition).where(UserPosition.user_id == user.id))
    tenure.start_date = date.today() - timedelta(days=3)
    tenure.end_date = date.today() - timedelta(days=1)
    await db_session.flush()
    product = await _make_testing_product(db_session, user)
    ac = authed_client_factory(user)
    assert (await ac.get(f"/shop/products/{product.id}")).status_code == 404
    assert (
        await ac.put(
            f"/shop/registrations/current/products/{product.id}",
            json={
                "variants": [{"option_ids": [], "quantity": 1}],
            },
        )
    ).status_code == 403
