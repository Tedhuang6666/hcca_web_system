"""每日收款依商品主題與實際付款日計算。"""

from datetime import UTC, datetime

from api.core.clock import TAIPEI
from api.models.shop import OrderItem, OrderStatus, Product, ProductCategory, ProductSeries
from api.models.shop_class_payment import ShopClassPayment
from api.services import shop as shop_svc
from tests.test_shop_router import _bare_user, _grant_permission, _make_class, _seed_order


async def test_report_keeps_previous_topic_on_its_actual_payment_day(
    db_session, authed_client_factory
):
    school_class = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    dance = ProductCategory(name="舞會")
    shirts = ProductCategory(name="紀念衫")
    db_session.add_all([dance, shirts])
    await db_session.flush()
    yesterday = datetime(2026, 11, 10, 15, 59, 59, tzinfo=UTC)
    today = datetime(2026, 11, 10, 16, 0, tzinfo=UTC)
    db_session.add(
        ShopClassPayment(
            class_id=school_class.id, activity_id=None, is_paid=True, confirmed_at=today
        )
    )
    for category, paid_at, amount in [
        (shirts, yesterday, 700),
        (dance, today, 100),
        (dance, today, 200),
    ]:
        order = await _seed_order(db_session, buyer, class_id=school_class.id, total_price=amount)
        order.category_id, order.paid_at, order.is_paid = category.id, paid_at, True
    unpaid = await _seed_order(db_session, buyer, class_id=school_class.id, total_price=900)
    unpaid.category_id = shirts.id
    for excluded in (OrderStatus.CANCELLED, OrderStatus.REFUNDED):
        order = await _seed_order(db_session, buyer, class_id=school_class.id, total_price=999)
        order.category_id, order.paid_at, order.is_paid = dance.id, today, True
        order.status = excluded
    gift = await _seed_order(db_session, buyer, class_id=school_class.id, total_price=888)
    gift.category_id, gift.paid_at, gift.is_paid = dance.id, today, True
    gift.assistance_scope = "council_gift"
    await db_session.flush()

    response = await authed_client_factory(manager).get("/shop/orders/class-payments")
    assert response.status_code == 200
    rows = {row["category_id"]: row for row in response.json()}
    assert len(rows) == 2
    assert rows[str(dance.id)]["category_label"] == "舞會"
    assert rows[str(dance.id)]["amount"] == 300
    assert rows[str(dance.id)]["order_count"] == 2
    assert rows[str(shirts.id)]["amount"] == 700
    assert rows[str(shirts.id)]["order_count"] == 1
    assert datetime.fromisoformat(rows[str(shirts.id)]["confirmed_at"]).astimezone(TAIPEI).day == 10
    assert datetime.fromisoformat(rows[str(dance.id)]["confirmed_at"]).astimezone(TAIPEI).day == 11
    assert len({row["record_id"] for row in rows.values()}) == 2


async def test_report_splits_discounted_legacy_supplement_by_product_topic(db_session):
    school_class = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    dance, shirts = ProductCategory(name="舞會"), ProductCategory(name="紀念衫")
    db_session.add_all([dance, shirts])
    await db_session.flush()
    series = ProductSeries(name="服飾系列", category_id=shirts.id)
    db_session.add(series)
    await db_session.flush()
    ticket = Product(name="門票", category_id=dance.id, price=100)
    shirt = Product(name="衣服", series_id=series.id, price=200)
    db_session.add_all([ticket, shirt])
    await db_session.flush()
    order = await _seed_order(
        db_session, buyer, class_id=school_class.id, total_price=199, is_paid=True
    )
    order.supplement_class_id = school_class.id
    order.paid_at = datetime(2026, 11, 11, tzinfo=UTC)
    order.subtotal_price, order.discount_amount = 300, 101
    db_session.add_all(
        [
            OrderItem(order_id=order.id, product_id=ticket.id, quantity=1, unit_price=100),
            OrderItem(order_id=order.id, product_id=shirt.id, quantity=1, unit_price=200),
        ]
    )
    await db_session.flush()

    rows = await shop_svc.class_payment_report(db_session)
    assert len(rows) == 2
    assert {row.category_id for row in rows} == {dance.id, shirts.id}
    assert {row.category_label for row in rows} == {"舞會", "紀念衫"}
    assert all(
        row.collection_type == "individual_order" and row.record_id == order.id for row in rows
    )
    assert all(row.order_count == 1 for row in rows)
    assert sum(row.amount for row in rows) == 199
    assert sorted(row.amount for row in rows) in ([66, 133], [67, 132])


async def test_report_uses_legacy_confirmation_only_when_order_has_no_paid_at(db_session):
    school_class = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    confirmed = datetime(2026, 11, 11, tzinfo=UTC)
    payment = ShopClassPayment(
        class_id=school_class.id, activity_id=None, is_paid=True, confirmed_at=confirmed
    )
    db_session.add(payment)
    order = await _seed_order(
        db_session, buyer, class_id=school_class.id, total_price=123, is_paid=True
    )
    await db_session.flush()

    rows = await shop_svc.class_payment_report(db_session)
    assert len(rows) == 1
    assert rows[0].amount == 123
    assert rows[0].category_id is None
    assert rows[0].category_label == "未分類商品"
    assert rows[0].confirmed_at == confirmed

    order.is_paid = False
    await db_session.flush()
    assert await shop_svc.class_payment_report(db_session) == []
