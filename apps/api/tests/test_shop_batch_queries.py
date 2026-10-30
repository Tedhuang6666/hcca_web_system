"""訂單列表應批次預載入，查詢數不得隨訂單數逐筆增加。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event

from api.models.activity import Activity
from api.models.school_class import SchoolClass
from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ProductSeries,
    ShopOrderPromotion,
    ShopPromotion,
)
from api.services import shop as shop_svc
from api.services.shop import _orders, _promotion_orders, _supplements


@pytest.fixture
async def order_batch(db_session, make_user, order_count):
    buyer = await make_user(student_id="510001")
    actor = await make_user()
    outsider = await make_user()
    classes = [
        SchoolClass(academic_year=115, class_code=str(index), created_by=actor.id)
        for index in (101, 102)
    ]
    promotion = ShopPromotion(
        name="批次優惠", discount_type="fixed", discount_value=10, created_by=actor.id
    )
    db_session.add_all([*classes, promotion])
    await db_session.flush()
    orders = []
    activity_ids = set()
    for index in range(order_count):
        activity = Activity(name=f"活動{index}")
        db_session.add(activity)
        await db_session.flush()
        activity_ids.add(activity.id)
        category = ProductCategory(
            name=f"主題{index}", activity_id=activity.id, created_by=actor.id
        )
        db_session.add(category)
        await db_session.flush()
        series = ProductSeries(name=f"系列{index}", category_id=category.id)
        db_session.add(series)
        await db_session.flush()
        product = Product(
            name=f"商品{index}",
            category_id=category.id if index % 2 == 0 else None,
            series_id=series.id,
            price=100,
            created_by=actor.id,
        )
        db_session.add(product)
        await db_session.flush()
        # 最後一筆模擬尚未寫入活動／分類快照的歷史訂單。
        order = Order(
            serial_number=f"BATCH-{uuid.uuid4().hex[:20]}",
            user_id=buyer.id,
            class_id=classes[0].id,
            assisted_by_id=actor.id,
            activity_id=activity.id if index != order_count - 1 else None,
            category_id=category.id if index != order_count - 1 else None,
            subtotal_price=100,
            total_price=90,
            discount_amount=10,
            created_at=datetime(2026, 10, 1, tzinfo=UTC) + timedelta(seconds=index),
            items=[OrderItem(product_id=product.id, quantity=1, unit_price=100)],
            applied_promotions=[ShopOrderPromotion(promotion_id=promotion.id, discount_amount=10)],
        )
        db_session.add(order)
        orders.append(order)
    await db_session.flush()
    return buyer, actor, outsider, classes, orders, activity_ids


@pytest.mark.parametrize("order_count", [1, 24])
@pytest.mark.parametrize("listing", ["registrations", "class_member", "supplements", "promotion"])
async def test_order_lists_have_bounded_queries(
    db_session, order_batch, order_count, listing, record_property
):
    buyer, actor, _, classes, seeded, activity_ids = order_batch
    buyer_id, actor_id, class_id = buyer.id, actor.id, classes[0].id
    if listing == "supplements":
        for order in seeded:
            order.supplement_class_id = class_id
            order.class_id = None
        await db_session.flush()
    expected_ids = [order.id for order in seeded]
    if listing != "promotion":
        expected_ids.reverse()
    db_session.expunge_all()
    statements = []

    def count_query(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    connection = (await db_session.connection()).sync_connection
    event.listen(connection, "before_cursor_execute", count_query)
    try:
        if listing == "registrations":
            orders = await shop_svc.get_current_registrations(db_session, buyer_id)
        elif listing == "class_member":
            orders = await _orders._get_class_member_orders(
                db_session, buyer_id, [class_id], lock=True
            )
        elif listing == "supplements":
            orders = await _supplements.list_supplements(
                db_session, actor_id=actor_id, class_ids={class_id}, limit=100, offset=0
            )
        else:
            orders = await _promotion_orders.lock_promotion_orders(
                db_session, activity_ids=activity_ids
            )
        payloads = [shop_svc.serialize_order(order) for order in orders]
        assert all(order.user.display_name for order in orders)
    finally:
        event.remove(connection, "before_cursor_execute", count_query)

    assert [order.id for order in orders] == expected_ids
    record_property("query_count", len(statements))
    # 含優惠預設預載入的四種目標資料；完整關聯的批次數不應逐筆增加。
    assert len(statements) <= 16, f"{listing}: {order_count} orders used {len(statements)} queries"
    for payload in payloads:
        assert payload.category_id is None
        assert payload.category_name is None
        assert payload.activity_id in activity_ids
        assert payload.items[0].product_name.startswith("商品")
        assert payload.applied_promotions[0].name == "批次優惠"
    assert any("FOR UPDATE" in statement for statement in statements) == (
        listing in {"class_member", "promotion"}
    )


@pytest.mark.parametrize("order_count", [24])
async def test_registration_batches_preserve_user_class_and_testing_filters(
    db_session, order_batch
):
    buyer, _, outsider, classes, orders, _ = order_batch
    orders[0].status = OrderStatus.CANCELLED
    orders[1].status = OrderStatus.REFUNDED
    orders[2].test_product_id = orders[2].items[0].product_id
    orders[3].supplement_class_id = classes[0].id
    orders[3].class_id = None
    orders[4].user_id = outsider.id
    orders[5].class_id = classes[1].id
    orders[6].class_id = None
    await db_session.flush()

    registered = await shop_svc.get_current_registrations(db_session, buyer.id)
    assert [order.id for order in registered] == [order.id for order in reversed(orders[5:])]
    testing = await shop_svc.get_current_registrations(db_session, buyer.id, include_testing=True)
    assert {order.id for order in testing} == {order.id for order in orders[5:]} | {orders[2].id}
    class_orders = await shop_svc.get_class_member_registrations(
        db_session, buyer.id, [classes[0].id]
    )
    assert [order.id for order in class_orders] == [order.id for order in reversed(orders[6:])]


@pytest.mark.parametrize("order_count", [24])
async def test_supplement_batches_preserve_actor_class_scope_and_pagination(
    db_session, order_batch
):
    _, actor, outsider, classes, orders, _ = order_batch
    for index, order in enumerate(orders):
        order.class_id = None
        order.supplement_class_id = classes[index % 2].id
        order.assisted_by_id = actor.id if index % 3 == 0 else outsider.id
        order.is_paid = index % 4 == 0
    orders[0].status = OrderStatus.CANCELLED
    orders[1].status = OrderStatus.REFUNDED
    await db_session.flush()
    expected = [
        order
        for order in orders[2:]
        if order.assisted_by_id == actor.id or order.supplement_class_id == classes[0].id
    ]
    expected.sort(key=lambda order: (order.is_paid, -order.created_at.timestamp(), order.id))
    result = await _supplements.list_supplements(
        db_session, actor_id=actor.id, class_ids={classes[0].id}, limit=5, offset=2
    )
    assert [order.id for order in result] == [order.id for order in expected[2:7]]
    all_orders = await _supplements.list_supplements(db_session, actor_id=None, limit=100, offset=0)
    assert {order.id for order in all_orders} == {order.id for order in orders[2:]}


@pytest.mark.parametrize("order_count", [24])
async def test_promotion_batches_preserve_payment_status_and_legacy_activity_filters(
    db_session, order_batch
):
    _, _, _, _, orders, activity_ids = order_batch
    orders[0].status = OrderStatus.CANCELLED
    orders[1].status = OrderStatus.REFUNDED
    orders[2].is_paid = True
    orders[3].is_class_collected = True
    orders[4].test_product_id = orders[4].items[0].product_id
    excluded_activity_id = orders[5].activity_id
    await db_session.flush()

    selected = await _promotion_orders.lock_promotion_orders(
        db_session, activity_ids=activity_ids - {excluded_activity_id}
    )
    assert [order.id for order in selected] == [order.id for order in orders[6:]]
