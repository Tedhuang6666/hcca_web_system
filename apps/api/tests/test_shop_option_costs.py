"""選項額外成本：真實 DB、採購盈利、銷售分析與內部資料範圍。"""

import uuid
from datetime import UTC, date, datetime
from io import BytesIO

import pytest
from openpyxl import load_workbook

from api.models.activity import Activity, ActivityConvener
from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
)
from api.services.shop._analytics import sales_analytics
from api.services.shop._analytics_report import render_sales_excel
from api.services.shop._costs import option_cost_key
from api.services.shop._profit import profit_analysis


@pytest.fixture
async def option_cost_data(db_session, admin_user, authed_client_factory):
    activity = Activity(name="成本測試活動")
    db_session.add(activity)
    await db_session.flush()
    category = ProductCategory(
        name="選項成本主題", activity_id=activity.id, created_by=admin_user.id
    )
    db_session.add(category)
    await db_session.flush()
    size = ProductVariantOption(value="XL", price_delta=20)
    print_option = ProductVariantOption(value="印字", price_delta=30)
    free = ProductVariantOption(value="原版", price_delta=0)
    unused = ProductVariantOption(value="未選加價", price_delta=50)
    product = Product(
        name="測試上衣",
        category_id=category.id,
        price=100,
        unit_cost=40,
        created_by=admin_user.id,
        status=ProductStatus.ACTIVE,
        is_unlimited=True,
        variant_groups=[
            ProductVariantGroup(name="尺寸", options=[size]),
            ProductVariantGroup(name="款式", options=[print_option, free, unused]),
        ],
    )
    db_session.add(product)
    await db_session.flush()

    def snapshot(option):
        return {
            "option_id": str(option.id),
            "group_id": str(option.group_id),
            "group_name": "尺寸" if option is size else "款式",
            "value": option.value,
            "price_delta": option.price_delta,
        }

    async def order(quantity, options, *, paid=True, status=OrderStatus.CONFIRMED, test=False):
        price = 100 + sum(option["price_delta"] for option in options)
        gross = quantity * price
        discount = 45 if quantity == 3 else 0
        row = Order(
            serial_number=f"OPTION-{uuid.uuid4().hex[:12]}",
            user_id=admin_user.id,
            activity_id=activity.id,
            status=status,
            test_product_id=product.id if test else None,
            created_at=datetime(2026, 11, 10, tzinfo=UTC),
            subtotal_price=gross,
            discount_amount=discount,
            total_price=gross - discount,
            is_paid=paid,
            items=[
                OrderItem(
                    product_id=product.id,
                    quantity=quantity,
                    unit_price=price,
                    selected_options=options,
                )
            ],
        )
        db_session.add(row)
        await db_session.flush()
        return row

    await order(3, [snapshot(size), snapshot(print_option)])
    await order(2, [snapshot(size)], paid=False)
    await order(1, [snapshot(free)])
    await order(9, [snapshot(size)], status=OrderStatus.CANCELLED)
    await order(9, [snapshot(size)], status=OrderStatus.REFUNDED)
    await order(9, [snapshot(size)], test=True)
    return (
        authed_client_factory(admin_user),
        activity,
        category,
        product,
        size,
        print_option,
        unused,
        order,
    )


async def test_option_costs_save_and_recalculate_whole_purchase(option_cost_data, db_session):
    admin, _, category, product, size, print_option, unused, _ = option_cost_data
    before = await profit_analysis(db_session, category)
    assert before.summary.total_cost is before.summary.profit_amount is None
    assert before.summary.missing_cost_product_count == 1
    assert (
        next(row for row in before.products[0].options if row.value == unused.value).total_cost == 0
    )
    payload = {
        "unit_cost": 40,
        "minimum_order_quantity": 10,
        "stock_extra_quantity": 1,
        "reserve_quantity": 1,
        "extra_cost": 50,
        "option_costs": {f"id:{size.id}": 4, f"id:{print_option.id}": 6},
    }
    response = await admin.put(f"/shop/products/{product.id}/procurement", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["option_costs"] == payload["option_costs"]
    assert response.headers["cache-control"] == "private, no-store"
    result = await admin.get("/shop/profit", params={"category_id": str(category.id)})
    assert result.status_code == 200, result.text
    summary = result.json()["summary"]
    assert summary["ordered_quantity"] == 6
    assert summary["purchase_quantity"] == 10
    assert summary["revenue"] == 745
    assert summary["paid_amount"] == 505
    assert summary["order_cost"] == 278  # 商品 240 + XL 20 + 印字 18
    assert summary["inventory_cost"] == 120
    assert summary["reserve_cost"] == 40
    assert summary["total_cost"] == 488
    assert summary["profit_amount"] == 257
    assert summary["cash_balance"] == 17
    row = result.json()["products"][0]
    assert row["option_cost"] == 38
    assert {option["value"]: option["ordered_quantity"] for option in row["options"]} == {
        "XL": 5,
        "印字": 3,
        "未選加價": 0,
    }
    for path in [f"/shop/products/{product.id}", "/shop/catalog", "/shop/products"]:
        public = await admin.get(path)
        assert public.status_code == 200, public.text
        assert "option_cost" not in public.text
        assert "unit_cost" not in public.text


@pytest.mark.parametrize("value", [0, None])
async def test_zero_and_unknown_option_cost_differ(option_cost_data, db_session, value):
    admin, _, category, product, size, print_option, _, _ = option_cost_data
    result = await admin.put(
        f"/shop/products/{product.id}/procurement",
        json={
            "unit_cost": 40,
            "option_costs": {f"id:{size.id}": value, f"id:{print_option.id}": 0},
        },
    )
    assert result.status_code == 200
    result = await profit_analysis(db_session, category)
    assert result.products[0].option_cost == (None if value is None else 0)
    assert result.summary.profit_amount == (None if value is None else 505)


@pytest.mark.parametrize("value", [-1, 1.5, True, "10", 2147483648])
async def test_invalid_option_cost_rejected(option_cost_data, value):
    admin, _, _, product, size, _, _, _ = option_cost_data
    response = await admin.put(
        f"/shop/products/{product.id}/procurement",
        json={"unit_cost": 40, "option_costs": {f"id:{size.id}": value}},
    )
    assert response.status_code == 422, response.text


async def test_option_cost_permissions_and_activity_scope(
    option_cost_data, db_session, client, make_user, authed_client_factory
):
    _, activity, category, product, size, _, _, _ = option_cost_data
    path = f"/shop/products/{product.id}/procurement"
    payload = {"unit_cost": 40, "option_costs": {f"id:{size.id}": 4}}
    assert (await client.put(path, json=payload)).status_code == 401
    outsider = authed_client_factory(await make_user())
    assert (await outsider.put(path, json=payload)).status_code == 403
    convener = await make_user()
    db_session.add(
        ActivityConvener(activity_id=activity.id, user_id=convener.id, start_date=date(2026, 1, 1))
    )
    await db_session.flush()
    scoped = authed_client_factory(convener)
    assert (await scoped.put(path, json=payload)).status_code == 200
    other_activity = Activity(name="其他活動")
    db_session.add(other_activity)
    await db_session.flush()
    category.activity_id = other_activity.id
    await db_session.flush()
    assert (await scoped.put(path, json=payload)).status_code == 403


async def test_deleted_renamed_and_legacy_options_keep_costs(option_cost_data, db_session):
    admin, _, category, product, size, print_option, _, order = option_cost_data
    size_id = size.id
    product.procurement_option_costs = {f"id:{size.id}": 4, f"id:{print_option.id}": 6}
    size.value = "加大"
    await db_session.flush()
    assert (await profit_analysis(db_session, category)).products[0].option_cost == 38
    response = await admin.delete(f"/shop/variant-options/{size_id}")
    assert response.status_code == 204, response.text
    db_session.expire(product, ["variant_groups"])
    result = await profit_analysis(db_session, category)
    deleted = next(row for row in result.products[0].options if row.key == f"id:{size_id}")
    assert deleted.ordered_quantity == 5
    assert deleted.unit_cost == 4
    assert result.products[0].option_cost == 38
    legacy = {"group_name": "舊款", "value": "XL", "price_delta": 20}
    await order(1, [legacy, legacy])  # 重複快照不重複計價或件數
    assert (await profit_analysis(db_session, category)).summary.profit_amount is None
    product.procurement_option_costs = {
        **product.procurement_option_costs,
        option_cost_key(legacy): 7,
    }
    await db_session.flush()
    result = await profit_analysis(db_session, category)
    assert result.products[0].option_cost == 45
    legacy_row = next(row for row in result.products[0].options if row.group_name == "舊款")
    assert legacy_row.ordered_quantity == 1
    assert legacy_row.total_cost == 7


async def test_sales_dimensions_and_excel_include_option_costs(option_cost_data, db_session):
    _, activity, _, product, size, print_option, _, _ = option_cost_data
    filters = dict(
        date_from=date(2026, 11, 10), date_to=date(2026, 11, 10), activity_id=activity.id
    )
    before = await sales_analytics(db_session, **filters)
    assert before.current.metrics.total_cost is before.current.metrics.profit_amount is None
    assert before.current.metrics.missing_cost_item_count == 5
    product.procurement_option_costs = {f"id:{size.id}": 4, f"id:{print_option.id}": 6}
    await db_session.flush()
    result = await sales_analytics(db_session, **filters)
    assert result.current.metrics.total_cost == 278
    assert result.current.metrics.profit_amount == 467
    for dimension in ("products", "variants", "sources", "grades", "classes", "buyer_segments"):
        assert sum(row.total_cost for row in getattr(result.current, dimension)) == 278
    workbook = load_workbook(BytesIO(render_sales_excel(result, "選項成本測試")))
    assert dict(workbook["關鍵指標"].values)["訂單毛利"] == 467
