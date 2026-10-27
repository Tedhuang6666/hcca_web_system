"""同一學生同一活動持續使用一張登記單的回歸。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncConnection, async_sessionmaker

from api.models.activity import Activity, ActivityStatus
from api.models.receivable import Receivable
from api.models.shop import (
    Order,
    OrderStatus,
    Product,
    ProductCategory,
    ProductStatus,
    ShopDelegationLink,
)
from api.models.user import User
from api.schemas.shop import (
    ClassOrderUpsert,
    CurrentRegistrationUpdate,
    OrderItemCreate,
    RegistrationVariantCreate,
    ShopPromotionCreate,
    ShopPromotionUpdate,
)
from api.services import shop as shop_svc


@pytest.fixture
async def registration_setup(db_session, make_user):
    buyer = await make_user(student_id="310001")
    actor = await make_user()
    activity = Activity(name="校慶", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    categories = [
        ProductCategory(name=name, activity_id=activity.id, created_by=actor.id)
        for name in ("服飾", "紀念品")
    ]
    db_session.add_all(categories)
    await db_session.flush()
    products = [
        Product(
            name=category.name,
            category_id=category.id,
            price=100,
            stock_quantity=20,
            status=ProductStatus.ACTIVE,
            created_by=actor.id,
        )
        for category in categories
    ]
    db_session.add_all(products)
    await db_session.flush()
    return buyer, actor, activity, products


async def _append(session, buyer, product, quantity=1, *, actor=None):
    return (
        await shop_svc.create_direct_order(
            session,
            user_id=buyer.id,
            class_id=None,
            assisted_by_id=actor.id if actor else None,
            data=ClassOrderUpsert(
                user_id=buyer.id,
                items=[OrderItemCreate(product_id=product.id, quantity=quantity)],
            ),
        )
    )[0]


async def test_new_automatic_promotion_reprices_existing_orders_and_receivables(
    db_session, registration_setup, make_user
):
    buyer, actor, activity, products = registration_setup
    order = await _append(db_session, buyer, products[0], 2)
    other = await make_user(student_id="310002")
    other_order = await _append(db_session, other, products[0], 2)
    original_stock = products[0].stock_quantity

    promotion = await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="追加帳號優惠",
            activity_id=activity.id,
            target_identifiers=[buyer.student_id],
            target_product_ids=[products[0].id],
            min_quantity=2,
            discount_type="fixed",
            discount_value=30,
        ),
        created_by=actor.id,
    )

    await db_session.refresh(order, attribute_names=["total_price", "discount_amount"])
    assert (order.discount_amount, order.total_price) == (30, 170)
    assert other_order.total_price == 200
    assert promotion.used_count == 1
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order.id))
    assert receivable.amount == 170
    assert products[0].stock_quantity == original_stock

    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(discount_value=50)
    )
    assert order.total_price == 150
    assert receivable.amount == 150
    assert promotion.used_count == 1
    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(target_identifiers=[other.student_id])
    )
    assert order.total_price == 200
    assert other_order.total_price == 150
    assert receivable.amount == 200
    assert promotion.used_count == 1


@pytest.mark.parametrize("lock", ["is_paid", "is_class_collected", "cancelled", "refunded"])
async def test_new_automatic_promotion_preserves_collected_and_historical_orders(
    db_session, registration_setup, lock
):
    buyer, actor, activity, products = registration_setup
    order = await _append(db_session, buyer, products[0], 2)
    if lock in {"cancelled", "refunded"}:
        order.status = OrderStatus(lock)
    else:
        setattr(order, lock, True)
    await db_session.flush()

    promotion = await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="追加優惠",
            activity_id=activity.id,
            discount_type="fixed",
            discount_value=30,
        ),
        created_by=actor.id,
    )
    assert order.total_price == 200
    assert order.discount_amount == 0
    assert promotion.used_count == 0
    receivable = await db_session.scalar(select(Receivable).where(Receivable.source_id == order.id))
    assert receivable.amount == 200


async def test_automatic_promotion_preserves_applied_coupon_and_usage_limit(
    db_session, registration_setup, make_user
):
    buyer, actor, activity, products = registration_setup
    coupon = await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="優惠碼",
            code="KEEP30",
            activity_id=activity.id,
            discount_type="fixed",
            discount_value=30,
        ),
        created_by=actor.id,
    )
    order = await _append(db_session, buyer, products[0], 2)
    await shop_svc.apply_registration_promotion(
        db_session, buyer, code=coupon.code, activity_id=activity.id
    )
    # PostgreSQL 的 now() 在同一 transaction 固定，明確建立先登記者的順序。
    order.created_at -= timedelta(minutes=1)
    coupon.ends_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()
    other = await make_user(student_id="310002")
    other_order = await _append(db_session, other, products[0], 2)

    promotion = await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="限一單追加優惠",
            activity_id=activity.id,
            discount_type="fixed",
            discount_value=20,
            max_uses=1,
        ),
        created_by=actor.id,
    )
    assert (order.promotion_code, order.discount_amount, order.total_price) == ("KEEP30", 50, 150)
    assert other_order.total_price == 200
    assert (coupon.used_count, promotion.used_count) == (1, 1)
    assert {row.promotion_id: row.discount_amount for row in order.applied_promotions} == {
        coupon.id: 30,
        promotion.id: 20,
    }
    await shop_svc.update_promotion(db_session, promotion, data=ShopPromotionUpdate(name="改名"))
    assert (coupon.used_count, promotion.used_count) == (1, 1)
    assert order.total_price == 150
    assert other_order.total_price == 200


async def test_limited_promotion_releases_ineligible_usage_before_retargeting(
    db_session, registration_setup, make_user
):
    buyer, actor, activity, products = registration_setup
    earlier = await _append(db_session, buyer, products[0])
    earlier.created_at -= timedelta(minutes=1)
    other = await make_user(student_id="310002")
    later = await _append(db_session, other, products[0])
    promotion = await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="限一單帳號優惠",
            activity_id=activity.id,
            target_identifiers=[other.student_id],
            discount_type="fixed",
            discount_value=20,
            max_uses=1,
        ),
        created_by=actor.id,
    )
    assert (earlier.total_price, later.total_price, promotion.used_count) == (100, 80, 1)

    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(target_identifiers=[buyer.student_id])
    )
    assert (earlier.total_price, later.total_price, promotion.used_count) == (80, 100, 1)


async def test_promotion_activity_change_reprices_both_scopes_and_deactivation_removes_discount(
    db_session, registration_setup
):
    buyer, actor, activity, products = registration_setup
    original = await _append(db_session, buyer, products[0])
    other_activity = Activity(name="畢業季", status=ActivityStatus.ACTIVE)
    db_session.add(other_activity)
    await db_session.flush()
    category = ProductCategory(name="畢業商品", activity_id=other_activity.id, created_by=actor.id)
    db_session.add(category)
    await db_session.flush()
    product = Product(
        name="紀念品",
        category_id=category.id,
        price=100,
        stock_quantity=20,
        status=ProductStatus.ACTIVE,
        created_by=actor.id,
    )
    db_session.add(product)
    await db_session.flush()
    other = await _append(db_session, buyer, product)
    promotion = await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="活動優惠",
            activity_id=activity.id,
            discount_type="fixed",
            discount_value=20,
        ),
        created_by=actor.id,
    )
    assert (original.total_price, other.total_price) == (80, 100)
    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(activity_id=other_activity.id)
    )
    assert (original.total_price, other.total_price, promotion.used_count) == (100, 80, 1)
    await shop_svc.update_promotion(
        db_session, promotion, data=ShopPromotionUpdate(is_active=False)
    )
    assert (original.total_price, other.total_price, promotion.used_count) == (100, 100, 0)


async def test_repeated_assistance_accumulates_same_activity_and_receivable(
    db_session, registration_setup, make_user
):
    buyer, actor, activity, products = registration_setup
    first = await _append(db_session, buyer, products[0], 2, actor=actor)
    second = await _append(db_session, buyer, products[1], 1, actor=actor)
    third = await _append(db_session, buyer, products[0], 3, actor=actor)
    assert first.id == second.id == third.id
    assert {item.product_id: item.quantity for item in third.items} == {
        products[0].id: 5,
        products[1].id: 1,
    }
    assert third.total_price == 600
    assert [product.stock_quantity for product in products] == [15, 19]
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    receivables = (await db_session.scalars(select(Receivable))).all()
    assert len(receivables) == 1
    assert receivables[0].source_id == first.id
    assert receivables[0].amount == 600

    other = await make_user(student_id="310002")
    other_order = await _append(db_session, other, products[0])
    assert other_order.id != first.id

    other_activity = Activity(name="畢業季", status=ActivityStatus.ACTIVE)
    db_session.add(other_activity)
    await db_session.flush()
    category = ProductCategory(name="畢業商品", activity_id=other_activity.id, created_by=actor.id)
    db_session.add(category)
    await db_session.flush()
    product = Product(
        name="畢業冊",
        category_id=category.id,
        price=200,
        stock_quantity=10,
        status=ProductStatus.ACTIVE,
        created_by=actor.id,
    )
    db_session.add(product)
    await db_session.flush()
    separate = await _append(db_session, buyer, product)
    assert separate.id != first.id
    assert separate.activity_id != activity.id


async def test_student_family_and_class_assistance_share_totals_and_keep_sources(
    db_session, registration_setup
):
    buyer, actor, _, products = registration_setup
    product = products[0]
    first = await shop_svc.set_current_registration_product(
        db_session,
        buyer,
        product.id,
        data=CurrentRegistrationUpdate(variants=[RegistrationVariantCreate(quantity=1)]),
    )
    link = ShopDelegationLink(
        user_id=buyer.id,
        category_id=product.category_id,
        activity_id=first.activity_id,
        name="家人",
        token_hash=uuid.uuid4().hex * 2,
    )
    db_session.add(link)
    await db_session.flush()
    family = await shop_svc.set_current_registration_product(
        db_session,
        buyer,
        product.id,
        actor=actor,
        delegation=link,
        data=CurrentRegistrationUpdate(variants=[RegistrationVariantCreate(quantity=2)]),
    )
    assisted = await _append(db_session, buyer, product, 3, actor=actor)
    assert first.id == family.id == assisted.id
    assert sum(item.quantity for item in assisted.items) == 6
    assert sum(item.quantity for item in assisted.items if item.delegation_link_id == link.id) == 2
    assert assisted.total_price == 600
    assert product.stock_quantity == 14
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1


@pytest.mark.parametrize("restart_with_assistance", [False, True])
async def test_clearing_and_registering_again_reuses_same_order(
    db_session, registration_setup, restart_with_assistance
):
    buyer, actor, _, products = registration_setup
    original = await _append(db_session, buyer, products[0], 2, actor=actor)
    original_id, serial = original.id, original.serial_number
    await shop_svc.set_current_registration_product(
        db_session, buyer, products[0].id, data=CurrentRegistrationUpdate(variants=[])
    )
    assert products[0].stock_quantity == 20
    if restart_with_assistance:
        resumed = await _append(db_session, buyer, products[1], 3, actor=actor)
    else:
        resumed = await shop_svc.set_current_registration_product(
            db_session,
            buyer,
            products[1].id,
            data=CurrentRegistrationUpdate(variants=[RegistrationVariantCreate(quantity=3)]),
        )
    assert resumed.id == original_id
    assert resumed.serial_number == serial
    assert [(item.product_id, item.quantity) for item in resumed.items] == [(products[1].id, 3)]
    assert products[1].stock_quantity == 17
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    assert await db_session.scalar(select(func.count()).select_from(Receivable)) == 1


async def test_explicit_cancellation_then_registering_again_does_not_restore_cancelled_items(
    db_session, registration_setup
):
    buyer, actor, _, products = registration_setup
    original = await _append(db_session, buyer, products[0], 2, actor=actor)
    await shop_svc.cancel_order(db_session, original, requested_by=buyer.id)
    resumed = await _append(db_session, buyer, products[1], 1, actor=actor)
    assert resumed.id == original.id
    assert [(item.product_id, item.quantity) for item in resumed.items] == [(products[1].id, 1)]
    assert [product.stock_quantity for product in products] == [20, 19]
    assert resumed.total_price == 100


async def test_replace_keeps_order_and_coupon_usage_without_allocating_temporary_order(
    db_session, registration_setup, monkeypatch
):
    buyer, actor, activity, products = registration_setup
    promotion = await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="校慶折扣",
            code="ONEFORM",
            activity_id=activity.id,
            discount_type="fixed",
            discount_value=30,
            max_uses=1,
        ),
        created_by=actor.id,
    )
    order = await _append(db_session, buyer, products[0], 2, actor=actor)
    await shop_svc.apply_registration_promotion(
        db_session, buyer, code=promotion.code, activity_id=activity.id
    )

    async def forbid_new_serial(session):
        raise AssertionError("修改總量不應建立暫存單")

    monkeypatch.setattr("api.services.shop._orders.generate_order_serial", forbid_new_serial)
    updated = await shop_svc.replace_order_items(
        db_session,
        order,
        data=ClassOrderUpsert(
            user_id=buyer.id,
            items=[OrderItemCreate(product_id=products[1].id, quantity=3)],
        ),
    )
    assert updated.id == order.id
    assert updated.total_price == 270
    assert promotion.used_count == 1
    assert [product.stock_quantity for product in products] == [20, 17]
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1


@pytest.mark.parametrize("flag", ["is_paid", "is_class_collected"])
async def test_assistance_cannot_create_another_order_to_bypass_collection_lock(
    db_session, registration_setup, flag
):
    buyer, actor, _, products = registration_setup
    order = await _append(db_session, buyer, products[0], actor=actor)
    setattr(order, flag, True)
    await db_session.flush()
    with pytest.raises(ValueError, match="已鎖定"):
        await _append(db_session, buyer, products[1], actor=actor)
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    assert products[1].stock_quantity == 20


async def test_concurrent_assistance_and_student_registration_share_one_order(db_session):
    bind = db_session.bind
    assert isinstance(bind, AsyncConnection)
    if bind.dialect.name != "postgresql":
        pytest.skip("需要 PostgreSQL row locks")
    factory = async_sessionmaker(bind.engine, expire_on_commit=False)
    async with factory() as session:
        buyer = User(email=f"{uuid.uuid4()}@hchs.hc.edu.tw", display_name="並發測試")
        session.add(buyer)
        await session.flush()
        activity = Activity(name="並發活動", status=ActivityStatus.ACTIVE)
        session.add(activity)
        await session.flush()
        category = ProductCategory(name="活動商品", activity_id=activity.id, created_by=buyer.id)
        session.add(category)
        await session.flush()
        products = [
            Product(
                name=f"商品{index}",
                category_id=category.id,
                created_by=buyer.id,
                price=100,
                stock_quantity=10,
                status=ProductStatus.ACTIVE,
            )
            for index in range(2)
        ]
        session.add_all(products)
        await session.commit()
        buyer_id, activity_id, category_id = buyer.id, activity.id, category.id
        product_ids = [product.id for product in products]
    try:

        async def register(assisted):
            async with factory() as session:
                user = await session.get(User, buyer_id)
                if assisted:
                    product = await session.get(Product, product_ids[0])
                    order = await _append(session, user, product, 2)
                else:
                    order = await shop_svc.set_current_registration_product(
                        session,
                        user,
                        product_ids[1],
                        data=CurrentRegistrationUpdate(
                            variants=[RegistrationVariantCreate(quantity=3)]
                        ),
                    )
                await session.commit()
                return order.id

        ids = await asyncio.wait_for(asyncio.gather(register(True), register(False)), timeout=10)
        assert ids[0] == ids[1]
        async with factory() as session:
            order = await shop_svc.get_order(session, ids[0])
            assert order.total_price == 500
            assert sum(item.quantity for item in order.items) == 5
            assert (
                await session.scalar(
                    select(func.count()).select_from(Order).where(Order.user_id == buyer_id)
                )
                == 1
            )
    finally:
        async with factory() as session:
            await session.execute(delete(Receivable).where(Receivable.user_id == buyer_id))
            await session.execute(delete(Order).where(Order.user_id == buyer_id))
            await session.execute(delete(Product).where(Product.id.in_(product_ids)))
            await session.execute(delete(ProductCategory).where(ProductCategory.id == category_id))
            await session.execute(delete(Activity).where(Activity.id == activity_id))
            await session.execute(delete(User).where(User.id == buyer_id))
            await session.commit()
