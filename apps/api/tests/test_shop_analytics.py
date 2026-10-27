"""銷售分析：真實資料庫、資料範圍、折扣、日期與授權。"""

import uuid
from datetime import date, datetime

import pytest

from api.core.clock import TAIPEI
from api.models.activity import Activity
from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory, ProductSeries
from api.services.shop._analytics import sales_analytics


@pytest.fixture
async def sales_data(db_session, make_user):
    buyer = await make_user()
    other = await make_user()
    activity = Activity(name="校慶")
    other_activity = Activity(name="其他活動")
    db_session.add_all([activity, other_activity])
    await db_session.flush()
    category = ProductCategory(name="服飾", activity_id=activity.id, created_by=buyer.id)
    other_category = ProductCategory(name="其他", created_by=buyer.id)
    db_session.add_all([category, other_category])
    await db_session.flush()
    series = ProductSeries(name="系列", category_id=category.id)
    db_session.add(series)
    await db_session.flush()
    shirt = Product(name="紀念衫", series_id=series.id, price=100, created_by=buyer.id)
    bag = Product(name="袋子", category_id=other_category.id, price=100, created_by=buyer.id)
    school_class = SchoolClass(academic_year=115, class_code="101", grade=1, created_by=buyer.id)
    db_session.add_all([shirt, bag, school_class])
    await db_session.flush()

    async def order(
        at,
        items,
        *,
        owner=buyer,
        paid=False,
        status=OrderStatus.PENDING,
        test=False,
        event=activity,
        sc=school_class,
        total=None,
    ):
        gross = sum(quantity * price for _, quantity, price in items)
        result = Order(
            serial_number=f"ANALYTICS-{uuid.uuid4().hex[:12]}",
            user_id=owner.id,
            activity_id=event.id,
            class_id=sc.id if sc else None,
            test_product_id=shirt.id if test else None,
            created_at=datetime.fromisoformat(at).replace(tzinfo=TAIPEI),
            status=status,
            subtotal_price=gross,
            total_price=gross if total is None else total,
            discount_amount=0 if total is None else gross - total,
            is_paid=paid,
            items=[
                OrderItem(
                    product_id=product.id,
                    quantity=quantity,
                    unit_price=price,
                    selected_options=[{"group_name": "尺寸", "value": "L"}],
                )
                for product, quantity, price in items
            ],
        )
        db_session.add(result)
        await db_session.flush()
        return result

    await order("2026-10-22T00:00:00", [(shirt, 2, 100), (bag, 1, 100)], paid=True, total=250)
    await order("2026-10-23T23:59:59.999999", [(shirt, 1, 100)], owner=other, sc=None)
    await order("2026-10-23T12:00:00", [(bag, 1, 0)], owner=other, sc=None)
    await order("2026-10-21T23:59:59.999999", [(shirt, 1, 100)])
    await order("2026-10-24T00:00:00", [(shirt, 1, 100)])
    await order("2026-10-22T12:00:00", [(shirt, 9, 100)], status=OrderStatus.CANCELLED)
    await order("2026-10-22T12:00:00", [(shirt, 9, 100)], status=OrderStatus.REFUNDED)
    await order("2026-10-22T12:00:00", [(shirt, 9, 100)], test=True)
    await order("2026-10-22T12:00:00", [(shirt, 9, 100)], event=other_activity)
    return activity, category, shirt, bag, school_class, order


async def test_sales_analytics_snapshot_distributions_and_taipei_boundaries(db_session, sales_data):
    activity, _, shirt, _, _, _ = sales_data
    result = await sales_analytics(
        db_session,
        date_from=date(2026, 10, 22),
        date_to=date(2026, 10, 23),
        activity_id=activity.id,
    )
    current = result.current
    assert current.metrics.order_count == 3
    assert current.metrics.buyer_count == 2
    assert current.metrics.item_count == 5
    assert current.metrics.total_amount == 350
    assert current.metrics.paid_amount == 250
    assert current.metrics.unpaid_amount == 100
    assert current.metrics.average_order_amount == 175
    assert current.metrics.discount_amount == 50
    assert [row.order_count for row in current.daily] == [1, 2]
    assert [row.cumulative_amount for row in current.daily] == [250, 350]
    assert current.hours[0].order_count == 1
    assert current.hours[23].order_count == 1
    assert {row.key: row.item_count for row in current.grades} == {"1": 3, "none": 2}
    assert {row.key: row.buyer_count for row in current.grades} == {"1": 1, "none": 1}
    assert sum(row.total_amount for row in current.products) == 350
    assert next(row for row in current.products if row.key == str(shirt.id)).item_count == 3
    assert sum(row.order_count for row in current.amount_bands) == 3
    assert sum(row.order_count for row in current.item_bands) == 3
    assert result.previous.metrics.order_count == 1
    assert [row.order_count for row in result.previous.daily] == [0, 1]


async def test_sales_product_and_category_filters_only_count_matching_items(db_session, sales_data):
    activity, category, shirt, bag, school_class, _ = sales_data
    common = dict(date_from=date(2026, 10, 22), date_to=date(2026, 10, 23), activity_id=activity.id)
    shirt_result = await sales_analytics(db_session, **common, product_id=shirt.id)
    bag_result = await sales_analytics(db_session, **common, product_id=bag.id)
    assert shirt_result.current.metrics.total_amount == 267
    assert shirt_result.current.metrics.paid_amount == 167
    assert bag_result.current.metrics.total_amount == 83
    assert (
        shirt_result.current.metrics.total_amount + bag_result.current.metrics.total_amount == 350
    )
    assert shirt_result.current.metrics.order_count == 2
    assert shirt_result.current.metrics.item_count == 3
    assert [row.key for row in shirt_result.current.products] == [str(shirt.id)]
    category_result = await sales_analytics(db_session, **common, category_id=category.id)
    assert category_result.current.metrics == shirt_result.current.metrics
    combined = await sales_analytics(
        db_session, **common, category_id=category.id, product_id=bag.id
    )
    assert combined.current.metrics.order_count == 0
    scoped = await sales_analytics(
        db_session, **common, grade=1, class_id=school_class.id, is_paid=True
    )
    assert scoped.current.metrics.order_count == 1
    assert scoped.current.metrics.total_amount == 250
    unpaid = await sales_analytics(db_session, **common, is_paid=False)
    assert unpaid.current.metrics.order_count == 2
    assert unpaid.current.metrics.paid_amount == 0


async def test_sales_comparison_empty_days_and_no_order_limit(db_session, sales_data):
    activity, _, shirt, _, _, order = sales_data
    for _ in range(501):
        await order("2025-10-22T11:00:00", [(shirt, 1, 1)])
    result = await sales_analytics(
        db_session,
        date_from=date(2026, 10, 22),
        date_to=date(2026, 10, 24),
        compare_from=date(2025, 10, 22),
        activity_id=activity.id,
    )
    assert result.previous.metrics.order_count == 501
    assert [row.order_count for row in result.previous.daily] == [501, 0, 0]
    empty = await sales_analytics(
        db_session, date_from=date(2024, 1, 1), date_to=date(2024, 1, 1), compare=False
    )
    assert empty.previous is None
    assert empty.current.metrics.average_order_amount == 0
    assert empty.current.daily[0].cumulative_amount == 0
    assert len(empty.current.hours) == 24


async def test_sales_endpoint_permissions_and_date_validation(
    client, authed_client_factory, make_user, admin_user, sales_data
):
    assert (await client.get("/shop/orders/analytics")).status_code == 401
    # 無全校權限的不同帳號／組織皆不得取得分析。
    for _ in range(2):
        user = await make_user()
        assert (await authed_client_factory(user).get("/shop/orders/analytics")).status_code == 403
    ac = authed_client_factory(admin_user)
    good = await ac.get(
        "/shop/orders/analytics", params={"date_from": "2026-10-22", "date_to": "2026-10-23"}
    )
    assert good.status_code == 200
    assert good.json()["timezone"] == "Asia/Taipei"
    for params in [
        {"date_from": "2026-10-23", "date_to": "2026-10-22"},
        {"date_from": "2025-01-01", "date_to": "2026-12-31"},
        {"date_to": "not-a-date"},
        {"date_from": "9999-12-31"},
    ]:
        assert (await ac.get("/shop/orders/analytics", params=params)).status_code == 422


@pytest.mark.parametrize(
    "code", ["shop:manage", "shop:manage_orders", "shop:view_all", "finance:view", "admin:all"]
)
async def test_sales_endpoint_accepts_existing_global_view_permissions(
    db_session, authed_client_factory, make_user, code
):
    from api.core.clock import local_today
    from api.models.org import Org, Permission, Position, UserPosition

    user = await make_user()
    org = Org(name="分析權限測試")
    db_session.add(org)
    await db_session.flush()
    position = Position(name="統計檢視", org_id=org.id)
    db_session.add(position)
    await db_session.flush()
    db_session.add_all(
        [
            Permission(position_id=position.id, code=code),
            UserPosition(user_id=user.id, position_id=position.id, start_date=local_today()),
        ]
    )
    await db_session.flush()
    response = await authed_client_factory(user).get("/shop/orders/analytics")
    assert response.status_code == 200
    assert response.json()["current"]["metrics"]["order_count"] == 0
