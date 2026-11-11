"""真實 DB 驗證整列交易、來源去重與外部訂單存取邊界。"""

import uuid

import pytest
from sqlalchemy import func, select

from api.models.outbox import OutboxEvent
from api.models.receivable import Receivable
from api.models.shop import (
    Order,
    OrderStatus,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
)
from api.models.shop_sheet import ShopSheetRow, ShopSheetSource
from api.models.user import User
from api.schemas.shop import (
    ProductCategoryCreate,
    ProductCreate,
    ShopPromotionCreate,
    ShopPromotionUpdate,
)
from api.schemas.shop_sheet import ShopSheetConfig
from api.services import shop as shop_svc
from api.services.outbox import _handle_shop_order_confirmed
from api.services.shop import _sheet_import as importer
from api.services.shop._export import _fetch_order_report_rows
from api.services.shop._orders import _sync_order_promotions
from api.services.shop._sheet_reader import SheetReadError

HEADERS = ["時間戳記", "電子郵件地址", "姓名", "職稱", "辦公室", "外套", "雨傘"]


@pytest.fixture
async def catalog(db_session, admin_user):
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="組織預購", slug="organizations"),
        created_by=admin_user.id,
    )
    products = []
    for name, price in [("外套", 650), ("雨傘", 350)]:
        product = await shop_svc.create_product(
            db_session,
            data=ProductCreate(category_id=category.id, name=name, price=price, stock_quantity=30),
            created_by=admin_user.id,
        )
        await shop_svc.activate_product(db_session, product)
        products.append(product)
    group = ProductVariantGroup(product_id=products[0].id, name="尺寸", sort_order=0)
    group.options = [
        ProductVariantOption(value=value, is_active=True, price_delta=delta, sort_order=index)
        for index, (value, delta) in enumerate([("L", 0), ("XL", 20), ("2XL", 30)])
    ]
    db_session.add(group)
    source = ShopSheetSource(
        name="教師及家長會",
        spreadsheet_id="synthetic-spreadsheet-id",
        sheet_name="表單回覆 1",
        category_id=category.id,
        config=ShopSheetConfig().model_dump(mode="json"),
        enabled=False,
    )
    db_session.add(source)
    await db_session.flush()
    return source, products


def row(
    identity="2026/11/09 10:00:00", size="L2、XXL1", umbrellas="兩把", email="buyer@example.org"
):
    return [identity, email, "測試教師", "教師", "測試辦公室", size, umbrellas]


async def test_import_creates_unpaid_confirmed_order_receivable_and_one_notice(db_session, catalog):
    source, products = catalog
    users_before = await db_session.scalar(select(func.count()).select_from(User))
    result = await importer.import_rows(db_session, source, [HEADERS, row()])
    assert result.model_dump() == {"imported": 1, "updated": 0, "skipped": 0, "review": 0}, [
        record.error for record in await db_session.scalars(select(ShopSheetRow))
    ]
    order = await db_session.scalar(select(Order))
    assert order is not None
    assert (order.status, order.is_paid, order.is_class_collected) == (
        OrderStatus.CONFIRMED,
        False,
        False,
    )
    assert order.payment_method == "cash_on_pickup"
    assert order.user_id is None and order.class_id is None
    assert order.buyer_office == "測試辦公室" and order.buyer_name == "測試教師"
    assert order.total_price == 650 * 2 + 680 + 350 * 2
    assert products[0].stock_quantity == 27 and products[1].stock_quantity == 28
    assert await db_session.scalar(select(func.count()).select_from(User)) == users_before
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order.id))
    assert receivable.amount == order.total_price and receivable.paid_amount == 0
    notice = await db_session.scalar(
        select(OutboxEvent).where(OutboxEvent.event_type == "shop.order_confirmed")
    )
    assert notice.payload["external_preorder"] is True
    assert notice.payload["buyer_email"] == "buyer@example.org"
    assert notice.payload["items"][1]["selected_options"][0]["value"] == "2XL"
    full = await shop_svc.get_order(db_session, order.id)
    assert shop_svc.serialize_order(full).class_label == "測試辦公室"
    assert shop_svc.serialize_order_list_item(full).user_name == "測試教師"
    assert (await _fetch_order_report_rows(db_session))[0]["訂購人"] == "測試教師"


async def test_repeated_reordered_and_changed_responses_never_double_import(db_session, catalog):
    source, products = catalog
    await importer.import_rows(db_session, source, [HEADERS, row()])
    result = await importer.import_rows(db_session, source, [HEADERS, [], row()])
    assert result.skipped == 1
    result = await importer.import_rows(db_session, source, [HEADERS, row(size="XL3")])
    assert result.updated == 1 and result.review == 0
    record = await db_session.scalar(select(ShopSheetRow))
    assert record.status == "imported" and record.row_number == 2
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "shop.order_confirmed")
        )
        == 2
    )
    assert products[0].stock_quantity == 27
    assert products[1].stock_quantity == 28
    order = await shop_svc.get_order(db_session, uuid.UUID(record.order_ids[0]))
    assert order.total_price == 670 * 3 + 350 * 2
    result = await importer.import_rows(db_session, source, [HEADERS, row(size="XL3")])
    assert result.skipped == 1 and result.updated == 0


async def test_invalid_row_rolls_back_inventory_but_later_rows_import(db_session, catalog):
    source, products = catalog
    values = [HEADERS, row(size="L2、超大1"), row(identity="second", size="L1", umbrellas="1")]
    result = await importer.import_rows(db_session, source, values)
    assert (result.imported, result.review) == (1, 1)
    await db_session.refresh(products[0])
    await db_session.refresh(products[1])
    assert (products[0].stock_quantity, products[1].stock_quantity) == (29, 29)
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    # 修正原始填答後可重試原列。
    values[1] = row(size="L2")
    result = await importer.import_rows(db_session, source, values)
    assert (result.imported, result.skipped) == (1, 1)


@pytest.mark.parametrize(
    "kind", ["email", "quantity", "stock", "restriction", "unmapped", "missing_office"]
)
async def test_unsafe_answers_remain_review_without_partial_orders(db_session, catalog, kind):
    source, products = catalog
    values = [HEADERS, row()]
    if kind == "email":
        values[1][1] = ""
    if kind == "quantity":
        values[1][-1] = "1.5"
    if kind == "stock":
        values[1][-1] = "99"
    if kind == "restriction":
        products[0].max_quantity_per_user = 2
    if kind == "unmapped":
        values = [HEADERS + ["不明商品"], row() + ["1"]]
    if kind == "missing_office":
        values[1][4] = ""
    await db_session.flush()
    result = await importer.import_rows(db_session, source, values)
    assert result.review == 1
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0
    assert await db_session.scalar(select(func.count()).select_from(Receivable)) == 0
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "shop.order_confirmed")
        )
        == 0
    )
    await db_session.refresh(products[0])
    await db_session.refresh(products[1])
    assert products[0].stock_quantity == products[1].stock_quantity == 30


async def test_duplicate_timestamps_need_unique_identity_before_import(db_session, catalog):
    source, _products = catalog
    result = await importer.import_rows(db_session, source, [HEADERS, row(), row(size="XL1")])
    assert result.imported == 0 and result.review == 2
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0


async def test_changed_timestamp_on_an_imported_row_does_not_create_second_order(
    db_session, catalog
):
    source, _products = catalog
    await importer.import_rows(db_session, source, [HEADERS, row()])
    result = await importer.import_rows(
        db_session, source, [HEADERS, row(identity="edited-timestamp", size="XL1")]
    )
    assert result.updated == 1 and result.imported == result.review == 0
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    assert (await db_session.scalar(select(ShopSheetRow))).status == "imported"


async def test_header_order_mapping_and_other_office_are_respected(db_session, catalog):
    source, products = catalog
    source.config = {**source.config, "product_columns": {"衣服尺寸與件數": str(products[0].id)}}
    headers = [
        "若所屬辦公室未在上列選項",
        "辦公室",
        "姓名",
        "電子郵件地址",
        "時間戳記",
        "衣服尺寸與件數",
    ]
    result = await importer.import_rows(
        db_session,
        source,
        [headers, ["家長會", "其他", "測試組織", "group@example.org", "one", "XL兩件"]],
    )
    assert result.imported == 1
    order = await db_session.scalar(select(Order))
    assert order.buyer_office == "家長會" and order.total_price == 1340


async def test_source_read_failure_is_saved_and_next_sync_recovers(
    db_session, catalog, monkeypatch
):
    source, _products = catalog

    async def fail(*args):
        raise SheetReadError("Google Sheets 讀取失敗（HTTP 403）")

    monkeypatch.setattr(importer, "read_sheet", fail)
    assert (await importer.sync_source(db_session, source.id)).review == 1
    assert "403" in source.last_error

    async def succeed(*args):
        return [HEADERS, row()]

    monkeypatch.setattr(importer, "read_sheet", succeed)
    assert (await importer.sync_source(db_session, source.id)).imported == 1
    assert source.last_error is None and source.last_synced_at is not None


async def test_router_permissions_configuration_and_order_idor(
    db_session,
    catalog,
    client,
    authed_client_factory,
    admin_user,
    make_user,
    monkeypatch,
):
    source, _products = catalog
    stranger = authed_client_factory(await make_user())
    path = f"/shop/sheet-sources/{source.id}"
    for actor, code in [(client, 401), (stranger, 403)]:
        for method, url, payload in [
            ("GET", "/shop/sheet-sources", None),
            ("POST", "/shop/sheet-sources", {}),
            ("GET", path + "/rows", None),
            ("POST", path + "/sync", {}),
            ("PATCH", path + "/enabled", {"enabled": True}),
            ("PUT", path, {}),
        ]:
            assert (await actor.request(method, url, json=payload)).status_code == code
    manager = authed_client_factory(admin_user)
    payload = {
        "name": "另一個表單",
        "spreadsheet_id": "another-synthetic-spreadsheet-id",
        "sheet_name": "表單回覆 1",
        "category_id": str(source.category_id),
    }
    created = await manager.post("/shop/sheet-sources", json=payload)
    assert created.status_code == 201, created.text
    assert created.json()["enabled"] is False
    assert (await manager.post("/shop/sheet-sources", json=payload)).status_code == 409
    assert (await manager.patch(path + "/enabled", json={"enabled": True})).json()[
        "enabled"
    ] is True

    async def fake_read(*args):
        return [HEADERS, row()]

    monkeypatch.setattr(importer, "read_sheet", fake_read)
    response = await manager.post(path + "/sync")
    assert response.status_code == 200 and response.json()["imported"] == 1, response.text
    rows = (await manager.get(path + "/rows")).json()
    assert "buyer@example.org" not in str(rows)
    order_id = rows[0]["order_ids"][0]
    assert (await manager.get(f"/shop/orders/{order_id}")).json()["class_label"] == "測試辦公室"
    assert (await stranger.get(f"/shop/orders/{order_id}")).status_code == 404
    assert (await client.get(f"/shop/orders/{order_id}")).status_code == 401
    unknown = f"/shop/sheet-sources/{uuid.uuid4()}"
    assert (await manager.get(unknown + "/rows")).status_code == 404


def test_external_notice_states_cash_on_delivery_and_retries(monkeypatch):
    sent = []
    monkeypatch.setattr("api.services.mail.enqueue_email", lambda *args: sent.append(args))
    payload = {
        "buyer_email": "buyer@example.org",
        "buyer_name": "<測試>",
        "buyer_office": "家長會",
        "serial_number": "ORD-test",
        "total_price": 650,
        "external_preorder": True,
        "items": [],
    }
    _handle_shop_order_confirmed(payload)
    assert "預購訂單成立通知" in sent[0][1]
    assert "付款方式：交貨時付款" in sent[0][2]
    assert "無須預先繳費或匯款" in sent[0][2]
    assert "&lt;測試&gt;" in sent[0][2] and "/shop/orders" not in sent[0][2]
    assert "我的訂單" not in sent[0][2] and "/contact" in sent[0][2]
    assert "編輯回覆" in sent[0][2] and "原回覆後重新提交" in sent[0][2]
    payload["order_updated"] = True
    payload["promotions"] = [{"name": "<套組優惠>", "discount_amount": 100}]
    _handle_shop_order_confirmed(payload)
    assert "預購訂單更新通知" in sent[1][1]
    assert "原訂單編號維持不變" in sent[1][2] and "&lt;套組優惠&gt;" in sent[1][2]

    def fail(*args):
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr("api.services.mail.enqueue_email", fail)
    with pytest.raises(RuntimeError, match="queue unavailable"):
        _handle_shop_order_confirmed(payload)


async def test_external_order_uses_existing_payment_cancel_and_quantity_flows(
    db_session,
    catalog,
    authed_client_factory,
    admin_user,
):
    source, products = catalog
    await importer.import_rows(db_session, source, [HEADERS, row(size="L1", umbrellas="0")])
    record = await db_session.scalar(select(ShopSheetRow))
    order_id = record.order_ids[0]
    manager = authed_client_factory(admin_user)
    detail = (await manager.get(f"/shop/orders/{order_id}")).json()
    item_id = detail["items"][0]["id"]
    response = await manager.patch(f"/shop/orders/{order_id}/items/{item_id}", json={"quantity": 2})
    assert response.status_code == 200, response.text
    assert response.json()["total_price"] == 1300
    assert (
        await importer.import_rows(db_session, source, [HEADERS, row(size="L1", umbrellas="0")])
    ).skipped == 1
    response = await manager.post(f"/shop/orders/{order_id}/cancel", json={"reason": "測試取消"})
    assert response.status_code == 200, response.text
    await db_session.refresh(products[0])
    assert products[0].stock_quantity == 30
    assert (
        await importer.import_rows(db_session, source, [HEADERS, row(size="L1", umbrellas="0")])
    ).skipped == 1
    assert (await manager.get(f"/shop/orders/{order_id}")).json()["status"] == "cancelled"


async def test_public_sheet_gid_is_passed_to_reader_without_changing_import_flow(
    db_session, catalog, monkeypatch
):
    source, _products = catalog
    source.config = {**source.config, "public_sheet_id": 0}

    async def public_read(*args):
        assert args == (source.spreadsheet_id, source.sheet_name, 10000, 0)
        return [HEADERS, row()]

    monkeypatch.setattr(importer, "read_sheet", public_read)
    assert (await importer.sync_source(db_session, source.id)).imported == 1
    order = await db_session.scalar(select(Order))
    assert order.status == OrderStatus.CONFIRMED and not order.is_paid


@pytest.fixture
async def quantity_only_catalog(db_session, catalog):
    source, products = catalog
    backpack = products[1]
    backpack.name = "背包"
    group = ProductVariantGroup(product_id=backpack.id, name="加購吊飾", sort_order=0)
    no_addon = ProductVariantOption(value="不加購", price_delta=0, is_active=True, sort_order=0)
    addon = ProductVariantOption(value="粉紅色", price_delta=25, is_active=True, sort_order=1)
    group.options = [no_addon, addon]
    db_session.add(group)
    await db_session.flush()
    header = "復刻款背包 NT.650 (尺寸S.M.L.XL)"
    config = ShopSheetConfig(
        product_columns={header: backpack.id},
        quantity_only_options={backpack.id: no_addon.id},
    )
    source.config = config.model_dump(mode="json")
    return source, backpack, no_addon, addon, [*HEADERS[:-1], header]


@pytest.mark.parametrize("quantity", ["2", "２個", "兩個"])
async def test_quantity_only_product_uses_free_default_and_system_price(
    db_session, quantity_only_catalog, quantity
):
    source, backpack, no_addon, _addon, headers = quantity_only_catalog
    values = [headers, row(size="0", umbrellas=quantity)]
    assert (await importer.import_rows(db_session, source, values)).imported == 1
    order = await shop_svc.get_order(db_session, await db_session.scalar(select(Order.id)))
    assert len(order.items) == 1
    item = order.items[0]
    assert item.quantity == 2 and item.unit_price == backpack.price == 350
    assert item.selected_options[0]["value"] == "不加購"
    assert item.selected_options[0]["option_id"] == str(no_addon.id)
    assert order.total_price == 700 and not order.is_paid
    assert backpack.stock_quantity == 28
    assert (await importer.import_rows(db_session, source, values)).skipped == 1
    notice = await db_session.scalar(select(OutboxEvent))
    assert notice.payload["total_price"] == 700
    assert notice.payload["items"][0]["selected_options"][0]["value"] == "不加購"
    assert await db_session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


@pytest.mark.parametrize("mode", ["inactive", "paid", "missing"])
async def test_quantity_only_default_must_be_active_free_and_belong_to_product(
    db_session, quantity_only_catalog, mode
):
    source, backpack, no_addon, addon, headers = quantity_only_catalog
    if mode == "inactive":
        no_addon.is_active = False
    elif mode == "paid":
        source.config = {
            **source.config,
            "quantity_only_options": {str(backpack.id): str(addon.id)},
        }
    else:
        source.config = {
            **source.config,
            "quantity_only_options": {str(backpack.id): str(uuid.uuid4())},
        }
    await db_session.flush()
    result = await importer.import_rows(
        db_session, source, [headers, row(size="L1", umbrellas="2")]
    )
    assert result.imported == 0 and result.review == 1
    assert "預設選項" in (await db_session.scalar(select(ShopSheetRow))).error
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0
    assert await db_session.scalar(select(func.count()).select_from(OutboxEvent)) == 0
    assert await db_session.scalar(select(func.count()).select_from(Receivable)) == 0
    await db_session.refresh(backpack)
    assert backpack.stock_quantity == 30


@pytest.mark.parametrize("answer", ["L2", "粉紅色兩個"])
async def test_quantity_only_default_does_not_silently_discard_size_or_addon_answers(
    db_session, quantity_only_catalog, answer
):
    source, _backpack, _no_addon, _addon, headers = quantity_only_catalog
    result = await importer.import_rows(
        db_session, source, [headers, row(size="0", umbrellas=answer)]
    )
    assert result.imported == 0 and result.review == 1
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0


async def test_other_sources_keep_explicit_addon_selection(db_session, quantity_only_catalog):
    source, backpack, _no_addon, _addon, headers = quantity_only_catalog
    source.config = {**source.config, "quantity_only_options": {}}
    result = await importer.import_rows(
        db_session, source, [headers, row(size="0", umbrellas="粉紅色兩個")]
    )
    assert result.imported == 1
    order = await shop_svc.get_order(db_session, await db_session.scalar(select(Order.id)))
    assert order.total_price == (backpack.price + 25) * 2
    assert order.items[0].selected_options[0]["value"] == "粉紅色"


async def test_purchase_words_import_complete_order_at_system_prices(db_session, catalog):
    source, _products = catalog
    values = [HEADERS, row(size="XL買1件", umbrellas="買1件")]
    assert (await importer.import_rows(db_session, source, values)).imported == 1
    order = await shop_svc.get_order(db_session, await db_session.scalar(select(Order.id)))
    assert order.total_price == 670 + 350
    assert order.status == OrderStatus.CONFIRMED and not order.is_paid
    assert {item.quantity for item in order.items} == {1}
    assert order.items[0].selected_options[0]["value"] == "XL"
    assert (await importer.import_rows(db_session, source, values)).skipped == 1
    assert await db_session.scalar(select(func.count()).select_from(OutboxEvent)) == 1


async def test_form_edits_reprice_same_order_and_release_promotion_usage(
    db_session, catalog, admin_user
):
    source, products = catalog
    promotion = await shop_svc.create_promotion(
        db_session,
        created_by=admin_user.id,
        data=ShopPromotionCreate(
            name="滿千折百", discount_type="fixed", discount_value=100, min_order_price=1000
        ),
    )
    await importer.import_rows(db_session, source, [HEADERS, row(size="L1", umbrellas="0")])
    record = await db_session.scalar(select(ShopSheetRow))
    order_id = uuid.UUID(record.order_ids[0])
    original = await shop_svc.get_order(db_session, order_id)
    serial = original.serial_number
    assert original.discount_amount == 0

    edited = row(size="XL2", umbrellas="1", email="updated@example.org")
    edited[2], edited[4] = "家長會代表", "家長會辦公室"
    result = await importer.import_rows(db_session, source, [HEADERS, edited])
    assert result.updated == 1 and result.imported == result.review == 0
    order = await shop_svc.get_order(db_session, order_id)
    assert order.serial_number == serial and order.user_id is None
    assert order.buyer_name == "家長會代表" and order.buyer_office == "家長會辦公室"
    assert order.subtotal_price == 1690 and order.discount_amount == 100
    assert order.total_price == 1590 and promotion.used_count == 1
    assert (products[0].stock_quantity, products[1].stock_quantity) == (28, 29)
    notices = list(await db_session.scalars(select(OutboxEvent).order_by(OutboxEvent.created_at)))
    assert len(notices) == 2 and notices[-1].payload["order_updated"] is True
    assert notices[-1].payload["buyer_email"] == "updated@example.org"
    assert notices[-1].payload["discount_amount"] == 100
    assert notices[-1].payload["promotions"][0]["name"] == "滿千折百"
    assert (await importer.import_rows(db_session, source, [HEADERS, edited])).skipped == 1
    assert promotion.used_count == 1

    result = await importer.import_rows(
        db_session, source, [HEADERS, row(size="L1", umbrellas="0")]
    )
    assert result.updated == 1
    order = await shop_svc.get_order(db_session, order_id)
    assert order.total_price == 650 and order.discount_amount == 0
    assert promotion.used_count == 0 and not order.applied_promotions
    receivables = list(await db_session.scalars(select(Receivable)))
    assert len(receivables) == 1 and receivables[0].amount == 650
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1


@pytest.mark.parametrize("reason", ["size", "stock", "empty", "paid", "cancelled", "closed"])
async def test_unsafe_form_edit_preserves_original_order_inventory_and_notice(
    db_session, catalog, reason
):
    source, products = catalog
    original = row(size="L1", umbrellas="1")
    await importer.import_rows(db_session, source, [HEADERS, original])
    order = await shop_svc.get_order(db_session, await db_session.scalar(select(Order.id)))
    edited = row(size="XL2", umbrellas="2")
    if reason == "size":
        edited[-2] = "不明尺寸"
    elif reason == "stock":
        edited[-1] = "99"
    elif reason == "empty":
        edited[-2:] = ["0", "0"]
    elif reason == "paid":
        order.is_paid = True
    elif reason == "cancelled":
        order.status = OrderStatus.CANCELLED
    elif reason == "closed":
        products[0].status = ProductStatus.CANCELLED
    await db_session.flush()
    result = await importer.import_rows(db_session, source, [HEADERS, edited])
    assert result.review == 1 and result.updated == result.imported == 0
    order = await shop_svc.get_order(db_session, order.id)
    assert order.subtotal_price == order.total_price == 1000
    assert [item.quantity for item in order.items] == [1, 1]
    for product in products:
        await db_session.refresh(product)
        assert product.stock_quantity == 29
    assert await db_session.scalar(select(func.count()).select_from(OutboxEvent)) == 1
    assert (await db_session.scalar(select(Receivable))).amount == 1000
    assert (await db_session.scalar(select(ShopSheetRow))).status == "changed"


async def test_timestamp_edit_cannot_replace_a_different_buyer_or_ambiguous_response(
    db_session, catalog
):
    source, _ = catalog
    await importer.import_rows(db_session, source, [HEADERS, row()])
    result = await importer.import_rows(
        db_session, source, [HEADERS, row(identity="new", email="different@example.org")]
    )
    assert result.review == 1 and result.imported == result.updated == 0
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    result = await importer.import_rows(
        db_session, source, [HEADERS, row(identity="new1"), row(identity="new2")]
    )
    assert result.review == 2 and result.imported == result.updated == 0
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1


async def test_timestamp_edit_and_row_reordering_keep_each_response_order(db_session, catalog):
    source, _ = catalog
    first = row(size="L1", umbrellas="0")
    second = row(identity="second", size="0", umbrellas="1", email="second@example.org")
    await importer.import_rows(db_session, source, [HEADERS, first, second])
    records = list(await db_session.scalars(select(ShopSheetRow).order_by(ShopSheetRow.row_number)))
    original_ids = [record.order_ids[0] for record in records]
    edited = row(identity="edited-time", size="XL2", umbrellas="0")
    result = await importer.import_rows(db_session, source, [HEADERS, second, edited])
    assert result.updated == result.skipped == 1 and result.imported == result.review == 0
    assert records[0].order_ids[0] == original_ids[0] and records[0].row_number == 3
    assert records[1].order_ids[0] == original_ids[1] and records[1].row_number == 2
    assert (await shop_svc.get_order(db_session, uuid.UUID(original_ids[0]))).total_price == 1340
    assert (await importer.import_rows(db_session, source, [HEADERS, second, edited])).skipped == 2


async def test_sold_out_product_can_change_size_without_reserving_quantity_twice(
    db_session, catalog
):
    source, products = catalog
    await importer.import_rows(db_session, source, [HEADERS, row(size="L30", umbrellas="0")])
    assert products[0].status == ProductStatus.SOLD_OUT and products[0].stock_quantity == 0
    result = await importer.import_rows(
        db_session, source, [HEADERS, row(size="XL30", umbrellas="0")]
    )
    assert result.updated == 1 and result.review == 0
    assert products[0].stock_quantity == 0
    result = await importer.import_rows(
        db_session, source, [HEADERS, row(size="XL29", umbrellas="0")]
    )
    assert result.updated == 1 and products[0].stock_quantity == 1
    assert products[0].status == ProductStatus.ACTIVE


async def test_resync_backfills_automatic_discounts_without_reimporting_items(
    db_session, catalog, admin_user
):
    source, products = catalog
    promotion = await shop_svc.create_promotion(
        db_session,
        created_by=admin_user.id,
        data=ShopPromotionCreate(
            name="套組優惠",
            discount_type="bundle_price",
            discount_value=900,
            target_product_ids=[product.id for product in products],
        ),
    )
    values = [HEADERS, row(size="L1", umbrellas="1")]
    await importer.import_rows(db_session, source, values)
    order = await shop_svc.get_order(db_session, await db_session.scalar(select(Order.id)))
    assert order.total_price == 900 and promotion.used_count == 1
    # 模擬舊版已成立但尚未套優惠的預購；不改商品價格或訂購件數。
    await _sync_order_promotions(db_session, order, ())
    order.discount_amount, order.total_price = 0, 1000
    await db_session.flush()
    result = await importer.import_rows(db_session, source, values)
    assert result.updated == 1 and result.imported == 0
    assert order.total_price == 900 and promotion.used_count == 1
    assert (products[0].stock_quantity, products[1].stock_quantity) == (29, 29)
    assert (await db_session.scalar(select(Receivable))).amount == 900
    result = await importer.import_rows(db_session, source, values)
    assert result.skipped == 1 and result.updated == 0
    assert await db_session.scalar(select(func.count()).select_from(OutboxEvent)) == 2


async def test_promotion_changes_include_external_orders_but_keep_identity_restrictions(
    db_session, catalog, admin_user, make_user
):
    source, _ = catalog
    student = await make_user(student_id="410123")
    await importer.import_rows(db_session, source, [HEADERS, row(size="L1", umbrellas="0")])
    promotion = await shop_svc.create_promotion(
        db_session,
        created_by=admin_user.id,
        data=ShopPromotionCreate(name="通用優惠", discount_type="fixed", discount_value=100),
    )
    order = await shop_svc.get_order(db_session, await db_session.scalar(select(Order.id)))
    assert order.total_price == 550 and promotion.used_count == 1
    await shop_svc.update_promotion(
        db_session,
        promotion,
        data=ShopPromotionUpdate(target_identifiers=[student.email]),
    )
    assert order.total_price == 650 and promotion.used_count == 0
    await shop_svc.create_promotion(
        db_session,
        created_by=admin_user.id,
        data=ShopPromotionCreate(
            name="學號優惠",
            discount_type="fixed",
            discount_value=200,
            target_identifiers=[student.student_id],
        ),
    )
    await shop_svc.create_promotion(
        db_session,
        created_by=admin_user.id,
        data=ShopPromotionCreate(
            name="需優惠碼", code="PRIVATE", discount_type="fixed", discount_value=300
        ),
    )
    result = await importer.import_rows(
        db_session, source, [HEADERS, row(size="L2", umbrellas="0")]
    )
    assert result.updated == 1
    order = await shop_svc.get_order(db_session, order.id)
    assert order.discount_amount == 0 and order.total_price == 1300
