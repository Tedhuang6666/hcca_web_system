"""採購表使用真實訂單、目前成本與商品層級囤貨；內部成本不可外洩。"""

import uuid
from datetime import UTC, datetime
from io import BytesIO

import pytest
from openpyxl import load_workbook

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

PATH = "/shop/orders/quantities.xlsx"


@pytest.fixture
async def quantity_data(db_session, admin_user, authed_client_factory):
    category = ProductCategory(name="校商", created_by=admin_user.id)
    db_session.add(category)
    await db_session.flush()
    sizes = [ProductVariantOption(value="S"), ProductVariantOption(value="M", price_delta=20)]
    shirt = Product(
        name="上衣",
        price=300,
        sort_order=1,
        unit_cost=100,
        procurement_stock=12,
        category_id=category.id,
        created_by=admin_user.id,
        status=ProductStatus.ACTIVE,
        variant_groups=[ProductVariantGroup(name="尺寸", options=sizes)],
    )
    bag = Product(
        name="背包",
        price=600,
        sort_order=2,
        unit_cost=400,
        procurement_stock=7,
        category_id=category.id,
        created_by=admin_user.id,
        status=ProductStatus.ACTIVE,
        variant_groups=[],
    )
    unused = Product(
        name="=未售商品",
        price=1,
        sort_order=0,
        unit_cost=None,
        category_id=category.id,
        created_by=admin_user.id,
        status=ProductStatus.ACTIVE,
        variant_groups=[],
    )
    db_session.add_all([shirt, bag, unused])
    await db_session.flush()
    shirt.procurement_option_costs = {f"id:{sizes[1].id}": 0}
    for product, quantity, paid, status, test in [
        (shirt, 3, True, OrderStatus.CONFIRMED, False),
        (shirt, 2, False, OrderStatus.PENDING, False),
        (bag, 4, True, OrderStatus.CONFIRMED, False),
        (shirt, 90, True, OrderStatus.CANCELLED, False),
        (shirt, 80, True, OrderStatus.REFUNDED, False),
        (shirt, 70, True, OrderStatus.CONFIRMED, True),
    ]:
        db_session.add(
            Order(
                serial_number=uuid.uuid4().hex[:25],
                user_id=admin_user.id,
                total_price=product.price * quantity,
                status=status,
                is_paid=paid,
                created_at=datetime(2026, 11, 10, tzinfo=UTC),
                test_product_id=product.id if test else None,
                items=[
                    OrderItem(
                        product_id=product.id,
                        quantity=quantity,
                        unit_price=product.price,
                        selected_options=[
                            {"option_id": str(sizes[0].id), "group_name": "尺寸", "value": "S"}
                        ]
                        if product is shirt
                        else [],
                    )
                ],
            )
        )
    await db_session.flush()
    return authed_client_factory(admin_user), category, shirt, bag, sizes


async def test_quantity_workbook_matches_template_and_uses_configured_stock(quantity_data):
    admin, category, _, _, _ = quantity_data
    response = await admin.get(PATH, params={"category_id": str(category.id)})
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert "filename*=UTF-8''" in response.headers["content-disposition"]
    sheet = load_workbook(BytesIO(response.content)).active
    assert list(next(sheet.values)) == [
        "商品",
        "尺寸",
        "販賣",
        "囤貨",
        "總量",
        "商品總量",
        "價格(成本)",
        "總價",
    ]
    start = next(row[0].row for row in sheet if row[0].value == "上衣")
    assert [sheet.cell(start + index, 2).value for index in range(2)] == ["S", "M"]
    assert [sheet.cell(start + index, 3).value for index in range(2)] == [5, 0]
    assert sheet.cell(start, 4).value == 12
    assert sheet.cell(start + 1, 4).value is None
    assert f"D{start}:D{start + 1}" in sheet.merged_cells
    assert sheet.cell(start, 6).value == f"=SUM(E{start}:E{start + 1})+D{start}"
    assert sheet.cell(start, 7).value == 100
    assert f"G{start}:G{start + 1}" in sheet.merged_cells
    assert sheet.cell(start, 8).value == f"=F{start}*G{start}"
    bag = next(row[0].row for row in sheet if row[0].value == "背包")
    assert sheet.cell(bag, 3).value == 4
    assert sheet.cell(bag, 4).value == 7
    assert sheet.cell(bag, 5).value == f"=SUM(C{bag}:D{bag})"
    assert sheet.cell(bag, 7).value == 400
    assert sheet["A2"].value == "=未售商品"
    assert sheet["A2"].data_type == "s"
    assert sheet["G2"].value == "未設定"


async def test_quantity_export_filters_match_page_and_costs_recalculate(quantity_data, db_session):
    admin, _, shirt, _, sizes = quantity_data
    shirt.procurement_option_costs = {f"id:{sizes[0].id}": 15, f"id:{sizes[1].id}": 30}
    await db_session.flush()
    response = await admin.get(
        PATH,
        params={
            "product_id": str(shirt.id),
            "is_paid": "false",
            "status": "pending",
            "date_from": "2026-11-10T00:00:00Z",
            "date_to": "2026-11-10T23:59:59Z",
        },
    )
    assert response.status_code == 200, response.text
    sheet = load_workbook(BytesIO(response.content)).active
    assert sheet.max_row == 3
    assert sheet["C2"].value == 2
    assert sheet["G2"].value == 115
    assert sheet["G3"].value == 130
    assert sheet["H2"].value == "囤貨規格成本未定"
    response = await admin.get(
        PATH, params={"product_id": str(shirt.id), "date_from": "2026-11-11T00:00:00Z"}
    )
    sheet = load_workbook(BytesIO(response.content)).active
    assert sheet["C2"].value == sheet["C3"].value == 0


async def test_quantity_export_protects_internal_costs(
    quantity_data, client, make_user, authed_client_factory
):
    _, _, shirt, _, _ = quantity_data
    assert (await client.get(PATH)).status_code == 401
    outsider = authed_client_factory(await make_user())
    assert (await outsider.get(PATH, params={"product_id": str(shirt.id)})).status_code == 403
