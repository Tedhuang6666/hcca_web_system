"""班級部分收款、整班補收與金額一致性。"""

from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from pypdf import PdfReader
from sqlalchemy import select

from api.models.receivable import Receivable
from api.models.shop import OrderItem
from api.models.shop_class_collection import ShopClassCollection
from api.models.shop_class_payment import ShopClassPayment
from api.models.user import User
from api.services import receivable as receivable_svc
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.shop._class_payment_scope import paid_general_category_ids
from tests.test_shop_router import (
    _bare_user,
    _grant_permission,
    _make_active_product,
    _make_category,
    _make_class,
    _seed_order,
)


async def setup_payment(db):
    actor = await _bare_user(db)
    await _grant_permission(db, actor, "shop:manage_orders")
    school_class = await _make_class(db)
    category = await _make_category(db, actor)
    product = await _make_active_product(db, actor, category=category, price=3000)
    buyer = await _bare_user(db, student_id="11520")
    order = await _seed_order(db, buyer, class_id=school_class.id, total_price=3000)
    order.category_id = category.id
    order.subtotal_price = 3000
    db.add(OrderItem(order_id=order.id, product_id=product.id, quantity=1, unit_price=3000))
    await db.flush()
    return actor, school_class, category, order


async def test_partial_class_payment_and_balance_collection(
    db_session, authed_client_factory, client
):
    actor, school_class, category, order = await setup_payment(db_session)
    ac = authed_client_factory(actor)
    path = f"/shop/orders/classes/{school_class.id}/payment"
    payload = {
        "is_paid": True,
        "activity_id": None,
        "category_id": str(category.id),
        "received_amount": 2000,
        "expected_unpaid_amount": 3000,
    }
    assert (await client.patch(path, json=payload)).status_code == 401
    outsider = await _bare_user(db_session, student_id="11521")
    assert (await authed_client_factory(outsider).patch(path, json=payload)).status_code == 403
    await class_svc.add_cadre(db_session, school_class, user_id=outsider.id)
    assert (await authed_client_factory(outsider).patch(path, json=payload)).status_code == 403
    response = await ac.patch(path, json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["is_paid"] is False
    assert order.received_amount == 2000 and not order.is_paid
    assert (await ac.post(f"/shop/orders/{order.id}/separate")).status_code == 409
    assert (await ac.post(f"/shop/orders/{order.id}/rejoin-class")).status_code == 409
    assert order.class_id == school_class.id and order.is_class_balance
    payment = await db_session.scalar(
        select(ShopClassPayment).where(ShopClassPayment.class_id == school_class.id)
    )
    assert payment.is_paid and payment.confirmed_at is not None
    rows = (await ac.get("/shop/orders/supplements")).json()
    assert len(rows) == 1 and rows[0]["received_amount"] == 2000
    summary = await shop_svc.order_summary(db_session, group_by="class", category_id=category.id)
    assert (summary.total_amount, summary.paid_amount, summary.unpaid_amount) == (3000, 2000, 1000)
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order.id))
    assert (receivable.amount, receivable.paid_amount, receivable.status) == (3000, 2000, "partial")
    # 重送同一核對值不會再收兩千。
    assert (await ac.patch(path, json=payload)).status_code == 400
    assert order.received_amount == 2000
    first = await db_session.scalar(
        select(ShopClassCollection).where(ShopClassCollection.order_id == order.id)
    )
    first.collected_at = datetime.now(UTC) - timedelta(days=1)
    await db_session.flush()
    receipt = await ac.get(f"/shop/orders/{order.id}/supplement-receipt.pdf")
    assert receipt.status_code == 200
    text = "".join(page.extract_text() for page in PdfReader(BytesIO(receipt.content)).pages)
    assert "待補收款" in text and "1,000" in text
    response = await ac.patch(
        path,
        json={
            "is_paid": True,
            "activity_id": None,
            "category_id": str(category.id),
            "expected_unpaid_amount": 1000,
        },
    )
    assert response.status_code == 200, response.text
    assert order.is_paid and order.received_amount == 3000
    assert receivable.paid_amount == 3000 and receivable.status == "paid"
    report = await shop_svc.class_payment_report(db_session)
    assert sorted(row.amount for row in report) == [1000, 2000]
    await ac.patch(
        path, json={"is_paid": True, "activity_id": None, "category_id": str(category.id)}
    )
    assert sum(row.amount for row in await shop_svc.class_payment_report(db_session)) == 3000
    response = await ac.patch(
        path, json={"is_paid": False, "activity_id": None, "category_id": str(category.id)}
    )
    assert response.status_code == 200
    assert not order.is_paid and order.received_amount == 0 and not order.is_class_balance
    assert order.class_id == school_class.id and order.supplement_class_id is None
    assert (await ac.get("/shop/orders/supplements")).json() == []
    assert await shop_svc.class_payment_report(db_session) == []


@pytest.mark.parametrize(
    "amount,expected,status",
    [
        (0, 3000, 422),
        (-1, 3000, 422),
        (2000.5, 3000, 422),
        (3001, 3000, 400),
        (2000, None, 400),
        (2000, 2000, 400),
    ],
)
async def test_partial_payment_rejects_invalid_amounts(
    db_session, authed_client_factory, amount, expected, status
):
    actor, school_class, category, order = await setup_payment(db_session)
    response = await authed_client_factory(actor).patch(
        f"/shop/orders/classes/{school_class.id}/payment",
        json={
            "is_paid": True,
            "activity_id": None,
            "category_id": str(category.id),
            "received_amount": amount,
            "expected_unpaid_amount": expected,
        },
    )
    assert response.status_code == status, response.text
    assert order.received_amount == 0 and not order.is_paid


async def test_class_balance_preserves_receivable_sync_and_scope(db_session, authed_client_factory):
    actor, school_class, category, order = await setup_payment(db_session)
    other_category = await _make_category(db_session, actor, name="另一活動")
    buyer = await db_session.get(User, order.user_id)
    other = await _seed_order(db_session, buyer, class_id=school_class.id, total_price=500)
    other.category_id = other_category.id
    await db_session.flush()
    await shop_svc.set_class_paid(
        db_session,
        school_class.id,
        is_paid=True,
        actor_id=actor.id,
        activity_id=None,
        category_id=category.id,
        received_amount=2000,
        expected_unpaid_amount=3000,
    )
    assert not other.is_paid and not other.is_class_balance and other.received_amount == 0
    receivable = await receivable_svc.sync_shop_order(db_session, order)
    assert receivable.paid_amount == 2000
    await receivable_svc.mark_paid(db_session, receivable, actor_id=actor.id)
    assert order.is_paid and order.class_id == school_class.id
    assert sum(row.amount for row in await shop_svc.class_payment_report(db_session)) == 3000
    assert category.id in await paid_general_category_ids(db_session, school_class.id)


async def test_partial_payment_spans_orders_and_preserves_previous_payments(db_session):
    actor, school_class, category, order = await setup_payment(db_session)
    order.total_price = 1500
    buyer = await db_session.get(User, order.user_id)
    paid = await _seed_order(
        db_session, buyer, class_id=school_class.id, total_price=500, is_paid=True
    )
    unpaid = await _seed_order(db_session, buyer, class_id=school_class.id, total_price=1000)
    paid.category_id = unpaid.category_id = category.id
    # 這兩筆僅用分類快照；補上品項供原有分類篩選查詢。
    product = await _make_active_product(db_session, actor, category=category)
    for item in (paid, unpaid):
        db_session.add(
            OrderItem(
                order_id=item.id, product_id=product.id, quantity=1, unit_price=item.total_price
            )
        )
    await db_session.flush()
    await shop_svc.set_class_paid(
        db_session,
        school_class.id,
        is_paid=True,
        actor_id=actor.id,
        activity_id=None,
        category_id=category.id,
        received_amount=2000,
        expected_unpaid_amount=2500,
    )
    assert paid.is_paid and not paid.is_class_balance
    assert all(
        item.is_class_balance and item.class_id == school_class.id for item in (order, unpaid)
    )
    assert sum(item.received_amount for item in (order, unpaid)) == 2000
    assert sum(item.total_price - item.received_amount for item in (order, unpaid)) == 500
    await shop_svc.set_class_paid(
        db_session,
        school_class.id,
        is_paid=True,
        actor_id=actor.id,
        activity_id=None,
        category_id=category.id,
        expected_unpaid_amount=500,
    )
    assert all(item.is_paid for item in (order, paid, unpaid))
