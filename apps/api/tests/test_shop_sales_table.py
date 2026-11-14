"""售票整理表的單價、快照、合併儲存格與數值輸出。"""

import uuid
from datetime import UTC, date, datetime, timedelta
from io import BytesIO

import pytest
from openpyxl import load_workbook

from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductVariantGroup,
    ProductVariantOption,
)
from api.schemas.shop_analytics import ShopSalesAnalyticsOut, ShopSalesMetrics, ShopSalesPeriod
from api.services.shop._analytics_report import render_sales_excel
from api.services.shop._sales_table import (
    MAX_ZERO_COMBINATIONS,
    SalesTableRow,
    build_sales_table,
)


@pytest.fixture
def ticket():
    product_id, group_id = uuid.uuid4(), uuid.uuid4()
    return Product(
        id=product_id,
        name="預售票",
        price=150,
        category_id=uuid.uuid4(),
        series=None,
        variant_groups=[
            ProductVariantGroup(
                id=group_id,
                product_id=product_id,
                name="加購",
                options=[
                    ProductVariantOption(
                        id=uuid.uuid4(),
                        group_id=group_id,
                        value=value,
                        price_delta=price,
                        is_active=True,
                    )
                    for value, price in [
                        ("不加購", 0),
                        ("加購徽章", 25),
                        ("加購吊飾", 45),
                        ("加購吊飾+徽章", 65),
                    ]
                ],
            )
        ],
    )


def selected(product, index):
    group = product.variant_groups[0]
    option = group.options[index]
    return [
        {
            "group_id": str(group.id),
            "option_id": str(option.id),
            "group_name": group.name,
            "value": option.value,
        }
    ]


def order(product, index, quantity=1, price=None, **kwargs):
    options = selected(product, index) if index is not None else []
    return Order(
        id=uuid.uuid4(),
        created_at=kwargs.pop("created_at", datetime(2026, 10, 22, tzinfo=UTC)),
        status=kwargs.pop("status", OrderStatus.PENDING),
        test_product_id=kwargs.pop("test_product_id", None),
        items=[
            OrderItem(
                product=product,
                quantity=quantity,
                unit_price=price
                if price is not None
                else product.price + product.variant_groups[0].options[index].price_delta,
                selected_options=options,
            )
        ],
        **kwargs,
    )


def workbook(rows, discount=0):
    gross = sum(row.subtotal for row in rows)
    data = ShopSalesAnalyticsOut(
        generated_at=datetime(2026, 10, 22, tzinfo=UTC),
        current=ShopSalesPeriod(
            date_from=date(2026, 10, 22),
            date_to=date(2026, 10, 22),
            metrics=ShopSalesMetrics(
                item_count=sum(row.quantity for row in rows),
                total_amount=gross - discount,
                discount_amount=discount,
            ),
        ),
    )
    return load_workbook(BytesIO(render_sales_excel(data, "測試範圍", rows)), data_only=True)


def test_sales_table_groups_quantities_and_fills_unsold_options(ticket):
    rows = build_sales_table([order(ticket, 0, 2), order(ticket, 1, 3)])
    assert [(row.detail, row.unit_price, row.quantity, row.subtotal) for row in rows] == [
        ("不加購", 150, 2, 300),
        ("加購徽章", 175, 3, 525),
        ("加購吊飾", 195, 0, 0),
        ("加購吊飾+徽章", 215, 0, 0),
    ]
    book = workbook(rows)
    sheet = book.active
    assert sheet.title == "售票情形"
    assert [cell.value for cell in sheet[1]] == [
        "票種",
        "細目",
        "單價",
        "數量",
        "小計",
        "總數量",
        "總額",
    ]
    assert (sheet["F2"].value, sheet["G2"].value) == (5, 825)
    assert {str(region) for region in sheet.merged_cells} == {
        "A2:A5",
        "F2:F5",
        "G2:G5",
        "C6:E6",
        "F6:G6",
    }
    assert (sheet["B6"].value, sheet["F6"].value) == (5, 825)
    assert sheet.freeze_panes == "C2"
    assert sheet.page_setup.orientation == "landscape"
    assert sheet.page_setup.fitToWidth == 1
    assert "$A$1:$G$6" in sheet.print_area


def test_sales_table_keeps_historical_prices_and_latest_snapshot(ticket):
    first = order(ticket, 1, 2, price=175)
    second = order(ticket, 1, 1, price=175, created_at=first.created_at + timedelta(days=1))
    second.items[0].selected_options[0]["value"] = "新版徽章"
    repriced = order(ticket, 1, 3, price=185)
    ticket.price = 160
    rows = build_sales_table([first, second, repriced])
    sold = [row for row in rows if row.quantity]
    assert [(row.unit_price, row.quantity, row.subtotal) for row in sold] == [
        (175, 3, 525),
        (185, 3, 555),
    ]
    assert sold[0].detail == "新版徽章"
    assert sum(row.quantity for row in rows) == 6


def test_sales_table_excludes_cancelled_refunded_testing_and_other_products(ticket):
    another = Product(
        id=uuid.uuid4(),
        name="其他商品",
        price=10,
        category_id=uuid.uuid4(),
        series=None,
        variant_groups=[],
    )
    orders = [
        order(ticket, 0, 2),
        order(ticket, 0, 99, status=OrderStatus.CANCELLED),
        order(ticket, 0, 99, status=OrderStatus.REFUNDED),
        order(ticket, 0, 99, test_product_id=ticket.id),
        order(another, None, 99, price=10),
    ]
    for filters in ({"product_id": ticket.id}, {"category_id": ticket.category_id}):
        rows = build_sales_table(orders, **filters)
        assert sum(row.quantity for row in rows) == 2
        assert {row.product_id for row in rows} == {ticket.id}
    assert build_sales_table(orders, category_id=uuid.uuid4()) == []


def test_sales_table_preserves_option_identity_and_legacy_snapshots(ticket):
    first = order(ticket, 0)
    second = order(ticket, 0)
    second.items[0].selected_options[0]["option_id"] = str(uuid.uuid4())
    legacy = order(ticket, 0)
    legacy.items[0].selected_options = [{"group_name": "舊加購", "value": "已刪除"}]
    rows = build_sales_table([first, second, legacy])
    assert len([row for row in rows if row.quantity]) == 3
    assert sum(row.quantity for row in rows) == 3
    assert any(row.detail == "已刪除" and row.quantity == 1 for row in rows)


def test_sales_table_combination_order_does_not_duplicate_counts(ticket):
    first = order(ticket, 0)
    extra = {"group_id": "size", "option_id": "L", "group_name": "尺寸", "value": "L"}
    first.items[0].selected_options.append(extra)
    second = order(ticket, 0)
    second.items[0].selected_options = list(reversed(first.items[0].selected_options))
    rows = build_sales_table([first, second])
    sold = [row for row in rows if row.quantity]
    assert len(sold) == 1
    assert sold[0].quantity == 2
    assert "尺寸：L" in sold[0].detail


def test_sales_table_totals_include_free_tickets_addons_and_separate_discounts():
    ticket_id, addon_id = uuid.uuid4(), uuid.uuid4()
    rows = [
        SalesTableRow(ticket_id, "工作票", "不加購", 0, 2),
        SalesTableRow(ticket_id, "工作票", "加購徽章", 25, 2),
        SalesTableRow(addon_id, "單獨加購", "吊飾", 50, 1),
    ]
    book = workbook(rows, discount=25)
    sheet = book.active
    assert (sheet["F2"].value, sheet["G2"].value) == (4, 50)
    assert (sheet["A5"].value, sheet["B5"].value, sheet["F5"].value) == ("總數量", 5, 100)
    assert (sheet["C6"].value, sheet["F6"].value) == ("折抵", 25)
    assert (sheet["C7"].value, sheet["F7"].value) == ("折扣後總金額", 75)
    assert book["關鍵指標"]["B2"].value == 75


def test_sales_table_empty_and_formula_like_labels_are_safe():
    empty = workbook([]).active
    assert empty.max_row == 2
    assert (empty["B2"].value, empty["F2"].value) == (0, 0)
    name = '=HYPERLINK("https://example.test")'
    sheet = workbook([SalesTableRow(uuid.uuid4(), name, "=1+2", 10, 1)]).active
    assert sheet["A2"].value == name
    assert sheet["A2"].data_type == sheet["B2"].data_type == "s"
    assert sheet["E2"].value == 10


def test_sales_table_limits_only_zero_combinations(ticket):
    group = ticket.variant_groups[0]
    group.options.extend(
        ProductVariantOption(
            id=uuid.uuid4(), group_id=group.id, value=str(index), price_delta=index, is_active=True
        )
        for index in range(MAX_ZERO_COMBINATIONS)
    )
    rows = build_sales_table([order(ticket, 0, 2)])
    assert len(rows) == 1
    assert rows[0].quantity == 2
