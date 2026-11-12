"""全期採購盈利：真實 DB、整批成本、折扣分攤與活動資料範圍。"""

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from api.core.clock import local_today
from api.models.activity import Activity, ActivityConvener
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory, ProductStatus
from api.services.shop._profit import profit_analysis


@pytest.fixture
async def procurement_data(db_session, admin_user, authed_client_factory):
    activity = Activity(name="盈利活動")
    other_activity = Activity(name="另一活動")
    db_session.add_all([activity, other_activity])
    await db_session.flush()
    category = ProductCategory(name="服飾", activity_id=activity.id, created_by=admin_user.id)
    other = ProductCategory(
        name="其他商品", activity_id=other_activity.id, created_by=admin_user.id
    )
    db_session.add_all([category, other])
    await db_session.flush()
    shirt = Product(
        name="紀念衫",
        category_id=category.id,
        price=100,
        unit_cost=40,
        created_by=admin_user.id,
        status=ProductStatus.ACTIVE,
    )
    bag = Product(name="袋子", category_id=other.id, price=200, created_by=admin_user.id)
    db_session.add_all([shirt, bag])
    await db_session.flush()

    async def order(status=OrderStatus.CONFIRMED, test=False, paid=True):
        result = Order(
            serial_number=f"PROFIT-{uuid.uuid4().hex[:12]}",
            user_id=admin_user.id,
            activity_id=activity.id,
            status=status,
            test_product_id=shirt.id if test else None,
            subtotal_price=700,
            discount_amount=140,
            total_price=560,
            is_paid=paid,
            items=[
                OrderItem(product_id=shirt.id, quantity=3, unit_price=100, selected_options=[]),
                OrderItem(product_id=bag.id, quantity=2, unit_price=200, selected_options=[]),
            ],
        )
        db_session.add(result)
        await db_session.flush()

    await order()
    await order(OrderStatus.CANCELLED)
    await order(OrderStatus.REFUNDED)
    await order(test=True)
    return authed_client_factory(admin_user), activity, category, other, shirt, bag, order


async def test_minimum_stock_reserves_and_discounted_revenue(procurement_data, db_session):
    admin, _, category, _, shirt, _, _ = procurement_data
    stock = shirt.stock_quantity
    result = await admin.put(
        f"/shop/products/{shirt.id}/procurement",
        json={
            "unit_cost": 40,
            "minimum_order_quantity": 10,
            "stock_extra_quantity": 2,
            "reserve_quantity": 1,
            "extra_cost": 50,
            "note": "備品不出售",
        },
    )
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "private, no-store"
    response = await admin.get("/shop/profit", params={"category_id": str(category.id)})
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    summary = response.json()["summary"]
    assert summary["ordered_quantity"] == 3
    assert summary["purchase_quantity"] == 10
    assert summary["minimum_top_up_quantity"] == 4
    assert summary["sellable_stock_quantity"] == 6
    assert summary["reserve_quantity"] == 1
    assert summary["revenue"] == summary["paid_amount"] == 240
    assert summary["unpaid_amount"] == 0
    assert summary["order_cost"] == 120
    assert summary["inventory_cost"] == 240
    assert summary["reserve_cost"] == 40
    assert summary["total_cost"] == 450
    assert summary["profit_amount"] == summary["cash_balance"] == -210
    assert response.json()["products"][0]["plan"]["note"] == "備品不出售"
    await db_session.refresh(shirt)
    assert shirt.stock_quantity == stock
    assert shirt.status == ProductStatus.ACTIVE


async def test_demand_above_minimum_and_unpaid_revenue(procurement_data, db_session):
    _, _, category, _, shirt, _, order = procurement_data
    shirt.procurement_minimum, shirt.procurement_stock, shirt.procurement_reserve = 1, 2, 1
    await order(paid=False)
    await db_session.flush()
    result = await profit_analysis(db_session, category)
    row = result.products[0]
    assert row.ordered_quantity == 6
    assert row.purchase_quantity == 9
    assert row.minimum_top_up_quantity == 0
    assert row.sellable_stock_quantity == 2
    assert result.summary.revenue == 480
    assert result.summary.paid_amount == result.summary.unpaid_amount == 240
    assert row.profit_amount == 120
    assert row.cash_balance == -120


async def test_no_order_procurement_unknown_zero_cost_and_unused_product(
    procurement_data, db_session
):
    _, _, category, _, shirt, _, _ = procurement_data
    unsold = Product(
        name="未售商品",
        category_id=category.id,
        price=100,
        created_by=shirt.created_by,
        procurement_minimum=5,
        procurement_reserve=2,
        procurement_extra_cost=20,
    )
    unused = Product(
        name="未規劃商品", category_id=category.id, price=0, created_by=shirt.created_by
    )
    testing = Product(
        name="測試商品",
        category_id=category.id,
        price=0,
        created_by=shirt.created_by,
        status=ProductStatus.TESTING,
        procurement_minimum=999,
    )
    db_session.add_all([unsold, unused, testing])
    await db_session.flush()
    result = await profit_analysis(db_session, category)
    assert len(result.products) == 3
    assert result.summary.missing_cost_product_count == 1
    assert result.summary.total_cost is result.summary.profit_amount is None
    rows = {row.product_id: row for row in result.products}
    assert rows[unused.id].total_cost == rows[unused.id].profit_amount == 0
    assert rows[unsold.id].purchase_quantity == 5
    assert rows[unsold.id].sellable_stock_quantity == 3
    assert rows[unsold.id].total_cost is None
    unsold.unit_cost = 0
    await db_session.flush()
    result = await profit_analysis(db_session, category)
    assert result.summary.total_cost == 140
    assert result.summary.profit_amount == 100
    assert result.summary.missing_cost_product_count == 0
    unsold.unit_cost = 50
    await db_session.flush()
    changed = await profit_analysis(db_session, category)
    assert changed.summary.total_cost == 390
    assert changed.summary.profit_amount == -150


async def test_procurement_access_is_private_and_activity_scoped(
    procurement_data, client, make_user, authed_client_factory, db_session
):
    admin, activity, category, other, shirt, bag, _ = procurement_data
    read = f"/shop/profit?category_id={category.id}"
    write = f"/shop/products/{shirt.id}/procurement"
    assert (await client.get(read)).status_code == 401
    assert (await client.put(write, json={"unit_cost": 1})).status_code == 401
    outsider = authed_client_factory(await make_user())
    assert (await outsider.get(read)).status_code == 403
    assert (await outsider.put(write, json={"unit_cost": 1})).status_code == 403
    convener = await make_user()
    db_session.add(
        ActivityConvener(activity_id=activity.id, user_id=convener.id, start_date=local_today())
    )
    await db_session.flush()
    scoped = authed_client_factory(convener)
    assert (await scoped.get(read)).status_code == 200
    assert (await scoped.put(write, json={"unit_cost": 10})).status_code == 200
    assert (await scoped.get(f"/shop/profit?category_id={other.id}")).status_code == 403
    assert (
        await scoped.put(f"/shop/products/{bag.id}/procurement", json={"unit_cost": 1})
    ).status_code == 403
    assert (await admin.get(f"/shop/profit?category_id={uuid.uuid4()}")).status_code == 404
    assert (await admin.get("/shop/profit")).status_code == 422
    for response in [
        await client.get(f"/shop/products/{shirt.id}"),
        await client.get("/shop/catalog"),
    ]:
        assert response.status_code == 200
        assert "procurement" not in response.text
        assert "unit_cost" not in response.text


@pytest.mark.parametrize(
    "field", ["minimum_order_quantity", "stock_extra_quantity", "reserve_quantity", "extra_cost"]
)
@pytest.mark.parametrize("value", [-1, 1.5, None, True, 2147483648])
async def test_invalid_procurement_rejected(procurement_data, field, value):
    admin, _, _, _, shirt, _, _ = procurement_data
    result = await admin.put(
        f"/shop/products/{shirt.id}/procurement", json={"unit_cost": 0, field: value}
    )
    assert result.status_code == 422, result.text


async def test_database_rejects_negative_procurement_and_settings_survive_cost_patch(
    procurement_data, db_session
):
    admin, _, category, _, shirt, _, _ = procurement_data
    assert (
        await admin.put(
            f"/shop/products/{shirt.id}/procurement",
            json={
                "unit_cost": None,
                "minimum_order_quantity": 8,
            },
        )
    ).status_code == 200
    assert (
        await admin.patch(f"/shop/products/{shirt.id}", json={"unit_cost": 10})
    ).status_code == 200
    result = await profit_analysis(db_session, category)
    assert result.products[0].purchase_quantity == 8
    assert result.summary.total_cost == 80
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            shirt.procurement_reserve = -1
            await db_session.flush()


async def test_empty_category_has_zero_cost(procurement_data, db_session):
    _, _, _, _, shirt, _, _ = procurement_data
    empty = ProductCategory(name="空主題", created_by=shirt.created_by)
    db_session.add(empty)
    await db_session.flush()
    result = await profit_analysis(db_session, empty)
    assert result.products == []
    assert result.summary.profit_amount == result.summary.total_cost == 0


@pytest.mark.parametrize("paid", [True, False])
async def test_gift_discount_does_not_reduce_other_category_profit(
    procurement_data, db_session, paid
):
    _, activity, category, other, shirt, bag, _ = procurement_data
    db_session.add(
        Order(
            serial_number=f"PROFIT-{uuid.uuid4().hex[:12]}",
            user_id=shirt.created_by,
            activity_id=activity.id,
            status=OrderStatus.CONFIRMED,
            subtotal_price=450,
            discount_amount=100,
            total_price=350,
            is_paid=paid,
            items=[
                OrderItem(product_id=shirt.id, quantity=1, unit_price=350),
                OrderItem(
                    product_id=bag.id,
                    quantity=1,
                    unit_price=100,
                    gift_quantity=1,
                    gift_discount_amount=100,
                ),
            ],
        )
    )
    await db_session.flush()
    result = await profit_analysis(db_session, category)
    assert result.summary.revenue == 590  # 原有收入 240 + 本筆付費商品 350
    assert result.summary.profit_amount == 430
    assert result.summary.paid_amount == (590 if paid else 240)
    assert result.summary.unpaid_amount == (0 if paid else 350)
    assert result.summary.cash_balance == (430 if paid else 80)
    gifted_category = await profit_analysis(db_session, other)
    assert gifted_category.summary.revenue == 320  # 贈品收入為 0，保留原有訂單收入
