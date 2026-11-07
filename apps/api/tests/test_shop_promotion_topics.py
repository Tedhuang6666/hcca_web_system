"""優惠主題範圍、各主題門檻與跨主題指定價格的 PostgreSQL 回歸。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from api.models.activity import Activity, ActivityStatus
from api.models.receivable import Receivable
from api.models.shop import Product, ProductCategory, ProductSeries, ProductStatus
from api.schemas.shop import (
    ClassOrderUpsert,
    OrderItemCreate,
    ShopPromotionCreate,
    ShopPromotionUpdate,
)
from api.services import shop as shop_svc
from api.services.shop._promotions import resolve_promotions


@pytest.fixture
async def topic_shop(db_session, make_user):
    manager = await make_user()
    buyer = await make_user(student_id="410001")
    activity = Activity(name="共同活動", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    categories = [
        ProductCategory(
            name=name, activity_id=activity.id if index < 2 else None, created_by=manager.id
        )
        for index, name in enumerate(["衣服", "紀念品", "其他商品"])
    ]
    db_session.add_all(categories)
    await db_session.flush()
    series = ProductSeries(name="系列", category_id=categories[1].id)
    db_session.add(series)
    await db_session.flush()
    products = [
        Product(
            name=category.name,
            price=300,
            stock_quantity=100,
            category_id=category.id if index != 1 else None,
            series_id=series.id if index == 1 else None,
            status=ProductStatus.ACTIVE,
            created_by=manager.id,
        )
        for index, category in enumerate(categories)
    ]
    db_session.add_all(products)
    await db_session.flush()
    return manager, buyer, activity, categories, products


async def _promotion(session, setup, **values):
    manager, _, _, _, _ = setup
    return await shop_svc.create_promotion(
        session,
        created_by=manager.id,
        data=ShopPromotionCreate(
            name="主題優惠",
            target_category_ids=[],
            discount_type="fixed",
            discount_value=50,
            **values,
        ),
    )


async def _order(session, buyer, product, quantity=1):
    return (
        await shop_svc.create_direct_order(
            session,
            user_id=buyer.id,
            class_id=None,
            data=ClassOrderUpsert(
                user_id=buyer.id, items=[OrderItemCreate(product_id=product.id, quantity=quantity)]
            ),
        )
    )[0]


async def test_minimum_spend_never_combines_topics_sharing_one_activity(db_session, topic_shop):
    _, buyer, activity, _, products = topic_shop
    await _promotion(db_session, topic_shop, code="TOPIC500", min_order_price=500)
    preview = await shop_svc.preview_promotion(
        db_session,
        user_id=buyer.id,
        subtotal=600,
        activity_id=activity.id,
        code="TOPIC500",
        product_subtotals={products[0].id: 300, products[1].id: 300},
        product_quantities={products[0].id: 1, products[1].id: 1},
    )
    assert not preview.eligible
    assert preview.reason_code == "minimum_not_met"
    assert preview.shortfall == 200
    with pytest.raises(ValueError, match="各商品主題分開計算"):
        await shop_svc.resolve_promotion(
            db_session,
            user_id=buyer.id,
            subtotal=600,
            activity_id=activity.id,
            code="TOPIC500",
            product_subtotals={products[0].id: 300, products[1].id: 300},
            product_quantities={products[0].id: 1, products[1].id: 1},
        )


@pytest.mark.parametrize("quantities,expected", [((2, 1), 50), ((2, 2), 100)])
async def test_each_qualifying_topic_gets_its_own_discount(
    db_session, topic_shop, quantities, expected
):
    _, buyer, activity, _, products = topic_shop
    await _promotion(db_session, topic_shop, code="PER_TOPIC", min_order_price=500)
    amounts = {
        product.id: count * product.price
        for product, count in zip(products, quantities, strict=False)
    }
    result = await shop_svc.resolve_promotion(
        db_session,
        user_id=buyer.id,
        subtotal=sum(amounts.values()),
        activity_id=activity.id,
        code="PER_TOPIC",
        product_subtotals=amounts,
        product_quantities={
            product.id: count for product, count in zip(products, quantities, strict=False)
        },
    )
    assert result.discount_amount == expected


async def test_minimum_quantity_also_stays_within_each_topic(db_session, topic_shop):
    _, buyer, activity, _, products = topic_shop
    await _promotion(db_session, topic_shop, min_quantity=2)
    preview = await shop_svc.preview_promotion(
        db_session,
        user_id=buyer.id,
        subtotal=600,
        activity_id=activity.id,
        product_subtotals={row.id: 300 for row in products[:2]},
        product_quantities={row.id: 1 for row in products[:2]},
    )
    assert not preview.eligible
    assert preview.reason_code == "quantity_not_met"
    assert preview.quantity_shortfall == 1


async def test_coupon_preview_matches_stacked_topic_automatic_discount(db_session, topic_shop):
    manager, buyer, activity, categories, products = topic_shop
    await _promotion(db_session, topic_shop)
    await shop_svc.create_promotion(
        db_session,
        created_by=manager.id,
        data=ShopPromotionCreate(
            name="服飾優惠碼",
            code="CLOTHES25",
            target_category_ids=[categories[0].id],
            discount_type="fixed",
            discount_value=25,
        ),
    )
    context = {
        "user_id": buyer.id,
        "subtotal": 600,
        "activity_id": activity.id,
        "code": "CLOTHES25",
        "product_subtotals": {row.id: 300 for row in products[:2]},
        "product_quantities": {row.id: 1 for row in products[:2]},
    }
    preview = await shop_svc.preview_promotion(db_session, **context)
    result = await resolve_promotions(db_session, **context)
    assert preview.eligible
    assert preview.discount_amount == result.discount_amount == 125
    assert len(preview.allocations) == len(result.allocations) == 2


async def test_bundle_can_span_topics_without_combining_their_spend_threshold(
    db_session, topic_shop
):
    manager, buyer, activity, categories, products = topic_shop
    promotion = await shop_svc.create_promotion(
        db_session,
        created_by=manager.id,
        data=ShopPromotionCreate(
            name="衣服紀念品套組",
            target_category_ids=[row.id for row in categories[:2]],
            target_product_ids=[row.id for row in products[:2]],
            discount_type="bundle_price",
            discount_value=450,
        ),
    )
    context = {
        "user_id": buyer.id,
        "subtotal": 600,
        "activity_id": activity.id,
        "product_subtotals": {row.id: 300 for row in products[:2]},
        "product_quantities": {row.id: 1 for row in products[:2]},
    }
    assert (await shop_svc.resolve_promotion(db_session, **context)).discount_amount == 150
    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(min_order_price=500)
    )
    assert (await shop_svc.resolve_promotion(db_session, **context)).discount_amount == 0


async def test_selected_topics_exclude_other_topics_and_include_future_products(
    db_session, topic_shop
):
    manager, buyer, activity, categories, products = topic_shop
    promotion = await shop_svc.create_promotion(
        db_session,
        created_by=manager.id,
        data=ShopPromotionCreate(
            name="衣服優惠",
            target_category_ids=[categories[0].id],
            discount_type="percentage",
            discount_value=10,
        ),
    )
    later = Product(
        name="新商品",
        price=200,
        stock_quantity=100,
        category_id=categories[0].id,
        status=ProductStatus.ACTIVE,
        created_by=manager.id,
    )
    db_session.add(later)
    await db_session.flush()
    result = await shop_svc.resolve_promotion(
        db_session,
        user_id=buyer.id,
        subtotal=800,
        activity_id=activity.id,
        product_subtotals={products[0].id: 300, products[1].id: 300, later.id: 200},
        product_quantities={products[0].id: 1, products[1].id: 1, later.id: 1},
    )
    assert result.promotion.id == promotion.id
    assert result.discount_amount == 50


async def test_override_prices_work_across_topics_and_order_scopes(db_session, topic_shop):
    manager, buyer, _, categories, products = topic_shop
    promotion = await shop_svc.create_promotion(
        db_session,
        created_by=manager.id,
        data=ShopPromotionCreate(
            name="幹部價",
            target_category_ids=[row.id for row in categories],
            target_identifiers=[buyer.student_id],
            target_product_ids=[row.id for row in products],
            discount_type="price_override",
            discount_value=0,
            product_price_overrides=[
                {"product_id": row.id, "unit_price": 100 + index * 10}
                for index, row in enumerate(products)
            ],
        ),
    )
    assert promotion.activity_id is None
    for index, product in enumerate(products):
        order = await _order(db_session, buyer, product)
        assert order.promotion_id == promotion.id
        assert next(item for item in order.items if item.product_id == product.id).unit_price == 300
        expected = sum(200 - i * 10 for i in range(index + 1)) if index < 2 else 180
        assert order.discount_amount == expected
    serialized = shop_svc.serialize_promotion(promotion)
    assert set(serialized.target_category_ids) == {row.id for row in categories}


async def test_topic_update_reprices_unpaid_orders_in_every_activity(db_session, topic_shop):
    _, buyer, _, categories, products = topic_shop
    orders = [await _order(db_session, buyer, products[index]) for index in [0, 2]]
    promotion = await _promotion(db_session, topic_shop)
    assert [order.discount_amount for order in orders] == [50, 50]
    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(target_category_ids=[categories[0].id])
    )
    assert [order.discount_amount for order in orders] == [50, 0]
    receivables = list(
        await db_session.scalars(
            select(Receivable).where(Receivable.source_id.in_([row.id for row in orders]))
        )
    )
    assert sorted(row.amount for row in receivables) == [250, 300]
    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(name="只改名稱")
    )
    assert promotion.target_category_ids == [str(categories[0].id)]
    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(target_category_ids=[])
    )
    assert [order.discount_amount for order in orders] == [50, 50]


async def test_topic_scope_api_validates_ids_and_keeps_manager_permission(
    db_session, topic_shop, admin_user, member_user, client, authed_client_factory
):
    _, _, _, categories, products = topic_shop
    payload = {
        "name": "主題優惠",
        "target_category_ids": [str(categories[0].id)],
        "discount_type": "fixed",
        "discount_value": 50,
    }
    assert (await client.post("/shop/promotions", json=payload)).status_code == 401
    assert (
        await authed_client_factory(member_user).post("/shop/promotions", json=payload)
    ).status_code == 403
    manager = authed_client_factory(admin_user)
    response = await manager.post("/shop/promotions", json=payload)
    assert response.status_code == 201
    assert response.json()["target_category_ids"] == payload["target_category_ids"]
    missing = await manager.post(
        "/shop/promotions", json={**payload, "target_category_ids": [str(uuid.uuid4())]}
    )
    assert missing.status_code == 422
    mismatch = await manager.post(
        "/shop/promotions", json={**payload, "target_product_ids": [str(products[1].id)]}
    )
    assert mismatch.status_code == 422


@pytest.mark.parametrize("with_coupon", [False, True])
async def test_all_automatic_promotions_stack_and_match_preview(
    db_session, topic_shop, with_coupon
):
    manager, buyer, activity, categories, products = topic_shop
    promotions = []
    for index, amount in enumerate([40, 60, 80]):
        promotions.append(
            await shop_svc.create_promotion(
                db_session,
                created_by=manager.id,
                data=ShopPromotionCreate(
                    name=f"優惠{index + 1}",
                    target_category_ids=[row.id for row in categories[:2]],
                    target_product_ids=[products[index % 2].id],
                    discount_type="fixed",
                    discount_value=amount,
                ),
            )
        )
    if with_coupon:
        await _promotion(db_session, topic_shop, code="STACK50")
    context = {
        "user_id": buyer.id,
        "subtotal": 600,
        "activity_id": activity.id,
        "code": "STACK50" if with_coupon else None,
        "product_subtotals": {row.id: 300 for row in products[:2]},
        "product_quantities": {row.id: 1 for row in products[:2]},
    }
    preview = await shop_svc.preview_promotion(db_session, **context)
    result = await resolve_promotions(db_session, **context)
    assert preview.discount_amount == result.discount_amount == (280 if with_coupon else 180)
    expected = {row.id: amount for row, amount in zip(promotions, [40, 60, 80], strict=True)}
    assert {
        row.promotion.id: row.discount_amount
        for row in result.allocations
        if row.promotion.code is None
    } == expected
    assert preview.allocations == result.allocations
    assert all(row.name in preview.reason for row in promotions)


@pytest.mark.parametrize("with_coupon", [False, True])
async def test_stacked_discounts_never_exceed_subtotal(db_session, topic_shop, with_coupon):
    manager, buyer, activity, categories, products = topic_shop
    for index in range(3):
        await shop_svc.create_promotion(
            db_session,
            created_by=manager.id,
            data=ShopPromotionCreate(
                name=f"折抵{index}",
                target_category_ids=[categories[0].id],
                discount_type="fixed",
                discount_value=200,
            ),
        )
    if with_coupon:
        await _promotion(db_session, topic_shop, code="CAP50")
    context = {
        "user_id": buyer.id,
        "subtotal": 300,
        "activity_id": activity.id,
        "code": "CAP50" if with_coupon else None,
        "product_subtotals": {products[0].id: 300},
        "product_quantities": {products[0].id: 1},
    }
    preview = await shop_svc.preview_promotion(db_session, **context)
    result = await resolve_promotions(db_session, **context)
    assert preview.discount_amount == result.discount_amount == 300
    assert preview.allocations == result.allocations
    assert len(result.allocations) == (3 if with_coupon else 2)
    assert all(row.discount_amount > 0 for row in result.allocations)


async def test_multiple_automatic_promotions_reprice_orders_and_receivables(db_session, topic_shop):
    manager, buyer, activity, categories, products = topic_shop
    order = await _order(db_session, buyer, products[0])
    promotions = []
    for index, amount in enumerate([50, 80, 100]):
        promotions.append(
            await shop_svc.create_promotion(
                db_session,
                created_by=manager.id,
                data=ShopPromotionCreate(
                    name=f"追加優惠{index}",
                    target_category_ids=[categories[0].id],
                    discount_type="fixed",
                    discount_value=amount,
                    max_uses=1,
                ),
            )
        )
    assert (order.discount_amount, order.total_price) == (230, 70)
    assert len(order.applied_promotions) == 3
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order.id))
    assert receivable.amount == 70
    preview = await shop_svc.preview_registration_promotion(
        db_session, user_id=buyer.id, code=None, activity_id=activity.id
    )
    assert len(preview.output.applied_promotions) == 3
    assert preview.output.discount_amount == 230
    await shop_svc.apply_registration_promotion(
        db_session, buyer, code=None, activity_id=activity.id
    )
    assert [row.used_count for row in promotions] == [1, 1, 1]
    assert order.total_price == 70
    await shop_svc.update_promotion(
        db_session, promotions[1], data=ShopPromotionUpdate(is_active=False)
    )
    assert (order.discount_amount, order.total_price, receivable.amount) == (150, 150, 150)
    assert [row.used_count for row in promotions] == [1, 0, 1]
    assert {row.promotion_id for row in order.applied_promotions} == {
        promotions[0].id,
        promotions[2].id,
    }
