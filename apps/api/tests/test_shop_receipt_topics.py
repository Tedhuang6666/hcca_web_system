"""各商品主題必須各自開立收據，包含未指定主題的批次與舊訂單。"""

import uuid
from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from pypdf import PdfReader
from sqlalchemy import func, select

from api.models.activity import Activity, ActivityStatus
from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory, ProductSeries
from api.models.shop_order_receipt_print import ShopOrderReceiptPrint
from api.services.shop import _receipts


@pytest.fixture
async def topics(db_session, admin_user, request):
    activity = None
    if request.param:
        activity = Activity(name="共同上層活動", status=ActivityStatus.ACTIVE)
        db_session.add(activity)
        await db_session.flush()
    school_class = SchoolClass(
        academic_year=115, class_code="101", label="一年一班", created_by=admin_user.id
    )
    db_session.add(school_class)
    categories = [
        ProductCategory(
            id=uuid.UUID(f"aaaaaaaa-0000-0000-0000-{index + 1:012d}"),
            name=f"主題{index + 1}",
            activity_id=activity.id if activity else None,
            created_by=admin_user.id,
        )
        for index in range(3)
    ]
    db_session.add_all(categories)
    await db_session.flush()
    series = ProductSeries(category_id=categories[0].id, name="第一主題系列")
    db_session.add(series)
    await db_session.flush()
    products = [
        Product(
            name=f"商品{index + 1}",
            price=(index + 1) * 101,
            category_id=category.id if index else None,
            series_id=series.id if index == 0 else None,
            created_by=admin_user.id,
        )
        for index, category in enumerate(categories)
    ]
    db_session.add_all(products)
    await db_session.flush()
    return school_class, activity, categories, products


async def _order(db, buyer, school_class, activity, products, *, total, supplement=False):
    order = Order(
        serial_number=f"ORD-TEST-{uuid.uuid4().hex[:8]}",
        user_id=buyer.id,
        class_id=school_class.id if school_class and not supplement else None,
        supplement_class_id=school_class.id if supplement else None,
        activity_id=activity.id if activity else None,
        status=OrderStatus.PENDING,
        total_price=total,
        items=[
            OrderItem(
                product_id=product.id,
                quantity=1,
                unit_price=product.price,
                selected_options=[],
            )
            for product in products
        ],
    )
    db.add(order)
    await db.flush()
    return order


def _page_totals(page):
    totals = []

    def visit(value, cm, tm, _font, _size):
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        top = 792 - (tm[4] * cm[1] + tm[5] * cm[3] + cm[5])
        if value.strip() and 302 < x < 410 and (320 < top < 345 or 665 < top < 691):
            totals.append(value.strip())

    page.extract_text(visitor_text=visit)
    return totals


def _assert_separate_topics(content, amounts):
    pdf = PdfReader(BytesIO(content))
    assert len(pdf.pages) == len(amounts)
    seen = set()
    for page in pdf.pages:
        text = "".join(page.extract_text().split())
        matches = [index for index in amounts if f"商品{index}" in text]
        assert len(matches) == 1, text
        topic = matches[0]
        assert topic not in seen
        seen.add(topic)
        assert text.count(f"主題{topic}") == 2
        assert text.count("收執聯") == text.count("存根聯") == 1
        assert _page_totals(page) == [str(amounts[topic])] * 2
        for other in set(amounts) - {topic}:
            assert f"主題{other}" not in text
    assert seen == set(amounts)


@pytest.mark.parametrize("topics", [False, True], indirect=True)
@pytest.mark.parametrize("mode", ["single", "selected", "all_unpaid", "changed"])
async def test_class_receipts_separate_topics_even_when_the_activity_matches(
    db_session, admin_user, authed_client_factory, topics, mode
):
    school_class, activity, categories, products = topics
    orders = []
    for index, product in enumerate(products):
        # 同主題的兩筆訂單仍合併為該班該主題的一份收據。
        for amount in (40, 60) if index == 0 else ((index + 1) * 100,):
            order = await _order(
                db_session, admin_user, school_class, activity, [product], total=amount
            )
            # 同時覆蓋有主題快照與僅能從品項推導主題的歷史訂單。
            order.category_id = categories[index].id if index == 1 else None
            orders.append(order)
    await db_session.flush()
    client = authed_client_factory(admin_user)
    scope = {"activity_id": str(activity.id) if activity else None}
    if mode == "single":
        response = await client.get(
            f"/shop/orders/classes/{school_class.id}/receipt.pdf",
            params={"activity_id": str(activity.id)} if activity else {},
        )
    elif mode == "changed":
        response = await client.post("/shop/orders/receipts/changed.pdf", json=scope)
    else:
        payload = {**scope, "unpaid_only": mode == "all_unpaid"}
        if mode == "selected":
            payload["class_ids"] = [str(school_class.id)]
        response = await client.post("/shop/orders/classes/receipts.pdf", json=payload)
    assert response.status_code == 200, response.text
    _assert_separate_topics(response.content, {1: 100, 2: 200, 3: 300})
    for order in orders:
        await db_session.refresh(order)
        assert order.is_paid is False
        assert await db_session.get(ShopOrderReceiptPrint, order.id) is not None


@pytest.mark.parametrize("topics", [False, True], indirect=True)
@pytest.mark.parametrize("mode", ["class", "personal", "supplement"])
async def test_legacy_order_spanning_topics_splits_items_and_preserves_the_paid_total(
    db_session, admin_user, authed_client_factory, topics, mode
):
    school_class, activity, _, products = topics
    order = await _order(
        db_session,
        admin_user,
        school_class if mode != "personal" else None,
        activity,
        products,
        total=605,  # 原始品項合計 606，分攤 1 元折抵後不得少算或重複計入。
        supplement=mode == "supplement",
    )
    client = authed_client_factory(admin_user)
    if mode == "supplement":
        response = await client.get(f"/shop/orders/{order.id}/supplement-receipt.pdf")
    else:
        response = await client.post(
            "/shop/orders/classes/receipts.pdf",
            json={
                "activity_id": str(activity.id) if activity else None,
                "unpaid_only": mode == "personal",
            },
        )
    assert response.status_code == 200, response.text
    _assert_separate_topics(response.content, {1: 100, 2: 202, 3: 303})
    await db_session.refresh(order)
    assert order.total_price == 605
    assert order.is_paid is False
    assert (
        await db_session.scalar(
            select(func.count(OrderItem.id)).where(OrderItem.order_id == order.id)
        )
        == 3
    )


@pytest.mark.parametrize("topics", [False], indirect=True)
async def test_changed_receipts_still_separate_topics_and_do_not_repeat_unchanged_orders(
    db_session, admin_user, authed_client_factory, topics, monkeypatch
):
    school_class, activity, _, products = topics
    orders = [
        await _order(db_session, admin_user, school_class, activity, [product], total=100 * index)
        for index, product in enumerate(products, 1)
    ]
    printed_at = datetime.now(UTC) + timedelta(seconds=1)
    monkeypatch.setattr(_receipts, "now_local", lambda: printed_at)
    client = authed_client_factory(admin_user)
    first = await client.post("/shop/orders/classes/receipts.pdf", json={})
    assert first.status_code == 200, first.text
    _assert_separate_topics(first.content, {1: 100, 2: 200, 3: 300})
    unchanged = await client.post("/shop/orders/receipts/changed.pdf", json={})
    assert unchanged.status_code == 400
    orders[0].total_price = 99
    orders[0].updated_at = printed_at + timedelta(seconds=1)
    await db_session.flush()
    monkeypatch.setattr(_receipts, "now_local", lambda: printed_at + timedelta(seconds=2))
    changed = await client.post("/shop/orders/receipts/changed.pdf", json={})
    assert changed.status_code == 200, changed.text
    _assert_separate_topics(changed.content, {1: 99, 2: 200, 3: 300})
