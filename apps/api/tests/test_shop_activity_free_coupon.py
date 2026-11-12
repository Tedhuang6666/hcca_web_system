"""活動免費券的指定人員、重複購買、完整計價與有效期回歸。"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from api.models.activity import Activity, ActivityStatus
from api.models.receivable import Receivable
from api.models.shop import Product, ProductStatus
from api.schemas.shop import (
    ClassOrderUpsert,
    OrderItemCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductVariantGroupCreate,
    ProductVariantOptionCreate,
    ShopPromotionCreate,
    ShopPromotionUpdate,
)
from api.services import shop as shop_svc


@pytest.fixture
async def free_coupon_shop(db_session, make_user):
    manager = await make_user()
    activity = Activity(name="免費券活動", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="校慶活動", activity_id=activity.id),
        created_by=manager.id,
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(
            category_id=category.id,
            name="紀念衣",
            price=300,
            stock_quantity=100,
            variant_groups=[
                ProductVariantGroupCreate(
                    name="尺寸", options=[ProductVariantOptionCreate(value="XL", price_delta=50)]
                )
            ],
        ),
        created_by=manager.id,
    )
    await shop_svc.activate_product(db_session, product)
    return manager, activity, category, await shop_svc.get_product(db_session, product.id)


@pytest.mark.parametrize("registered_before_coupon", [False, True])
async def test_activity_free_coupon_is_reusable_and_scoped_to_student_and_category(
    db_session, make_user, free_coupon_shop, registered_before_coupon
):
    manager, activity, category, product = free_coupon_shop
    buyer = await make_user(student_id="410001") if registered_before_coupon else None
    promotion = await shop_svc.create_promotion(
        db_session,
        created_by=manager.id,
        data=ShopPromotionCreate(
            name="幹部活動免費券",
            target_category_ids=[category.id],
            target_identifiers=["410001", "410003"],
            discount_type="percentage",
            discount_value=100,
            is_public=False,
        ),
    )
    if buyer is None:
        buyer = await make_user(student_id="410001")
    other = await make_user(student_id="410002")
    option_ids = [product.variant_groups[0].options[0].id]
    item = OrderItemCreate(product_id=product.id, quantity=3, option_ids=option_ids)

    # 一般套組不能保留應付金額；日後新增的同活動商品也必須全免。
    extra = Product(
        name="後續新增紀念品",
        price=100,
        stock_quantity=100,
        category_id=category.id,
        status=ProductStatus.ACTIVE,
        created_by=manager.id,
    )
    db_session.add(extra)
    await db_session.flush()
    await shop_svc.create_promotion(
        db_session,
        created_by=manager.id,
        data=ShopPromotionCreate(
            name="一般套組",
            target_category_ids=[category.id],
            target_product_ids=[product.id, extra.id],
            discount_type="bundle_price",
            discount_value=350,
        ),
    )
    items = [item, OrderItemCreate(product_id=extra.id, quantity=2)]
    for purchase_number in range(1, 3):
        order = (
            await shop_svc.create_direct_order(
                db_session,
                user_id=buyer.id,
                class_id=None,
                data=ClassOrderUpsert(user_id=buyer.id, items=items),
            )
        )[0]
        assert (order.discount_amount, order.total_price) == (1250 * purchase_number, 0)
        receivable = await db_session.scalar(
            select(Receivable).where(Receivable.source_id == order.id)
        )
        assert receivable.amount == 0
    # 同一人的追加登記沿用原訂單；不限次數也能供名單內其他人使用。
    assert promotion.used_count == 1
    second_buyer = await make_user(student_id="410003")
    second_order = (
        await shop_svc.create_direct_order(
            db_session,
            user_id=second_buyer.id,
            class_id=None,
            data=ClassOrderUpsert(user_id=second_buyer.id, items=items),
        )
    )[0]
    assert (second_order.discount_amount, second_order.total_price) == (1250, 0)
    assert promotion.used_count == 2
    assert promotion.max_uses is None
    preview = await shop_svc.preview_registration_promotion(
        db_session, user_id=buyer.id, code=None, activity_id=activity.id
    )
    assert preview.output.discount_amount == 2500

    other_order = (
        await shop_svc.create_direct_order(
            db_session,
            user_id=other.id,
            class_id=None,
            data=ClassOrderUpsert(user_id=other.id, items=[item]),
        )
    )[0]
    assert (other_order.discount_amount, other_order.total_price) == (0, 1050)

    other_category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="其他活動"), created_by=manager.id
    )
    unrelated = Product(
        name="其他活動商品",
        price=200,
        stock_quantity=10,
        category_id=other_category.id,
        status=ProductStatus.ACTIVE,
        created_by=manager.id,
    )
    db_session.add(unrelated)
    await db_session.flush()
    other_activity_order = (
        await shop_svc.create_direct_order(
            db_session,
            user_id=buyer.id,
            class_id=None,
            data=ClassOrderUpsert(
                user_id=buyer.id,
                items=[
                    OrderItemCreate(product_id=unrelated.id, quantity=1),
                ],
            ),
        )
    )[0]
    assert (other_activity_order.discount_amount, other_activity_order.total_price) == (0, 200)


@pytest.mark.parametrize("state", ["not_started", "expired", "inactive"])
async def test_activity_free_coupon_respects_validity_and_deactivation(
    db_session, make_user, free_coupon_shop, state
):
    manager, activity, category, product = free_coupon_shop
    buyer = await make_user(student_id="410001")
    now = datetime.now(UTC)
    promotion = await shop_svc.create_promotion(
        db_session,
        created_by=manager.id,
        data=ShopPromotionCreate(
            name="活動免費券",
            target_category_ids=[category.id],
            target_identifiers=[buyer.student_id],
            discount_type="percentage",
            discount_value=100,
            starts_at=now + timedelta(days=1) if state == "not_started" else None,
            ends_at=now - timedelta(days=1) if state == "expired" else None,
        ),
    )
    if state == "inactive":
        await shop_svc.update_promotion(
            db_session, promotion, data=ShopPromotionUpdate(is_active=False)
        )
    order = (
        await shop_svc.create_direct_order(
            db_session,
            user_id=buyer.id,
            class_id=None,
            data=ClassOrderUpsert(
                user_id=buyer.id,
                items=[
                    OrderItemCreate(
                        product_id=product.id,
                        quantity=1,
                        option_ids=[product.variant_groups[0].options[0].id],
                    )
                ],
            ),
        )
    )[0]
    assert (order.discount_amount, order.total_price) == (0, 350)
    assert promotion.used_count == 0
