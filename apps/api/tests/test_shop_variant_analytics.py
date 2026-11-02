"""選項銷售比較：真實 DB、主題隔離、快照與折扣分攤。"""

import uuid
from datetime import date, datetime
from io import BytesIO

from openpyxl import load_workbook

from api.core.clock import TAIPEI
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory
from api.services.shop._analytics import sales_analytics
from api.services.shop._analytics_report import render_sales_excel


async def test_variant_combinations_options_and_theme_scope(db_session, make_user):
    buyer = await make_user()
    themes = [ProductCategory(name=name, created_by=buyer.id) for name in ("服飾主題", "傳情主題")]
    db_session.add_all(themes)
    await db_session.flush()
    products = [
        Product(name="同名商品", category_id=theme.id, price=100, created_by=buyer.id)
        for theme in themes
    ]
    db_session.add_all(products)
    await db_session.flush()
    color, size, red, blue, large, small = [str(uuid.uuid4()) for _ in range(6)]

    def options(color_id, color_name, size_id, size_name):
        return [
            {"group_id": color, "group_name": "顏色", "option_id": color_id, "value": color_name},
            {"group_id": size, "group_name": "尺寸", "option_id": size_id, "value": size_name},
        ]

    async def add_order(
        day, items, *, total=None, paid=False, status=OrderStatus.PENDING, test=False
    ):
        gross = sum(item.quantity * item.unit_price for item in items)
        order = Order(
            serial_number=f"VARIANT-{uuid.uuid4().hex[:12]}",
            user_id=buyer.id,
            created_at=datetime(2026, 10, day, 12, tzinfo=TAIPEI),
            status=status,
            test_product_id=products[0].id if test else None,
            subtotal_price=gross,
            total_price=gross if total is None else total,
            discount_amount=0 if total is None else gross - total,
            is_paid=paid,
            items=items,
        )
        db_session.add(order)
        await db_session.flush()

    def item(product, qty, price, selected):
        return OrderItem(
            product_id=product.id, quantity=qty, unit_price=price, selected_options=selected
        )

    # 同單同商品多組合，且夾帶另一主題；折扣須先在整單分攤。
    await add_order(
        22,
        [
            item(products[0], 2, 100, options(red, "紅", large, "L")),
            item(products[0], 1, 200, options(blue, "藍", large, "L")[::-1]),
            item(products[1], 1, 100, []),
        ],
        total=400,
        paid=True,
    )
    # ID 相同但名稱已改，依 ID 合併，顯示最近名稱。
    await add_order(23, [item(products[0], 1, 100, options(red, "朱紅", small, "S"))])
    await add_order(24, [item(products[0], 1, 100, options(red, "朱紅", large, "L")[::-1])])
    for status, test in [
        (OrderStatus.CANCELLED, False),
        (OrderStatus.REFUNDED, False),
        (OrderStatus.PENDING, True),
    ]:
        await add_order(
            24,
            [item(products[0], 99, 100, options(red, "朱紅", large, "L"))],
            status=status,
            test=test,
        )

    result = await sales_analytics(
        db_session,
        date_from=date(2026, 10, 22),
        date_to=date(2026, 10, 24),
        category_id=themes[0].id,
    )
    period = result.current
    assert (period.metrics.item_count, period.metrics.total_amount) == (5, 520)
    assert sum(row.total_amount for row in period.variants) == 520
    assert sum(row.item_count for row in period.variants) == 5
    assert len(period.variants) == 3
    assert all(row.product_id == products[0].id for row in period.variants)
    options_by_value = {row.option_label: row for row in period.variant_options}
    red_row = options_by_value["朱紅"]
    assert (red_row.item_count, red_row.total_amount, red_row.paid_amount) == (4, 360, 160)
    assert (red_row.order_count, red_row.buyer_count) == (3, 1)
    assert (red_row.item_share, red_row.amount_share) == (80, 69.23)
    assert (options_by_value["L"].item_count, options_by_value["L"].total_amount) == (4, 420)
    assert (options_by_value["L"].order_count, options_by_value["L"].buyer_count) == (2, 1)
    assert sum(row.total_amount for row in period.variant_options) == 1040  # 兩組規格各涵蓋商品
    for group in {row.group_key for row in period.variant_options}:
        assert (
            sum(row.item_share for row in period.variant_options if row.group_key == group) == 100
        )

    other = await sales_analytics(
        db_session,
        date_from=date(2026, 10, 22),
        date_to=date(2026, 10, 24),
        category_id=themes[1].id,
    )
    assert other.current.metrics.total_amount == 80
    assert other.current.variants[0].option_label == "無規格"
    assert other.current.variant_options == []
    workbook = load_workbook(BytesIO(render_sales_excel(result, "服飾主題")))
    assert "單一選項" in workbook.sheetnames
    headers = [cell.value for cell in workbook["單一選項"][1]]
    assert "商品內銷量占比（%）" in headers
    assert any(
        row[1] == "顏色：朱紅" and row[-2:] == (80, 69.23)
        for row in workbook["單一選項"].iter_rows(min_row=2, values_only=True)
    )


async def test_legacy_option_identity_delimiters_and_zero_amount(db_session, make_user):
    buyer = await make_user()
    category = ProductCategory(name="舊商品主題", created_by=buyer.id)
    db_session.add(category)
    await db_session.flush()
    product = Product(name="舊商品", category_id=category.id, price=0, created_by=buyer.id)
    db_session.add(product)
    await db_session.flush()
    # 顯示文字相同的組合不能因分隔符而混在一起；同名但不同 ID 的選項也須分開。
    snapshots = [
        [{"group_name": "A", "value": "B / C：D"}],
        [{"group_name": "A", "value": "B"}, {"group_name": "C", "value": "D"}],
        [{"group_id": "g", "group_name": "A", "option_id": "one", "value": "B"}],
        [{"group_id": "g", "group_name": "A", "option_id": "two", "value": "B"}],
    ]
    db_session.add(
        Order(
            serial_number=f"LEGACY-{uuid.uuid4().hex[:12]}",
            user_id=buyer.id,
            created_at=datetime(2026, 10, 22, 12, tzinfo=TAIPEI),
            subtotal_price=0,
            total_price=0,
            items=[
                OrderItem(
                    product_id=product.id, quantity=1, unit_price=0, selected_options=selected
                )
                for selected in snapshots
            ],
        )
    )
    await db_session.flush()
    result = await sales_analytics(
        db_session, date_from=date(2026, 10, 22), date_to=date(2026, 10, 22)
    )
    assert len(result.current.variants) == 4
    assert all(row.item_share == 25 and row.amount_share == 0 for row in result.current.variants)
    assert all(
        row.order_count == 1 and row.buyer_count == 1 for row in result.current.variant_options
    )
