"""商品自己的截止時間控制訂購、購物車與截止提醒。"""

from datetime import UTC, datetime, timedelta

import pytest

from api.schemas.shop import (
    CartItemCreate,
    ClassOrderUpsert,
    OrderItemCreate,
    ProductCategoryCreate,
    ProductCreate,
)
from api.services import shop as shop_svc
from api.services.shop._deadlines import recently_closed_product_ids


@pytest.fixture
async def deadline_setup(db_session, admin_user, make_user, authed_client_factory):
    buyer = await make_user(student_id="310001", email="310001@hchs.hc.edu.tw")
    category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="截止測試商品"), created_by=admin_user.id
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(
            category_id=category.id, name="截止測試品項", price=100, stock_quantity=20
        ),
        created_by=admin_user.id,
    )
    await shop_svc.activate_product(db_session, product)
    return {
        "buyer": buyer,
        "student": authed_client_factory(buyer),
        "product": product,
        "category": category,
    }


async def test_expired_product_blocks_registration_and_direct_order(db_session, deadline_setup):
    setup = deadline_setup
    product = setup["product"]
    product.sale_end = datetime.now(UTC) - timedelta(hours=1)
    await db_session.flush()

    response = await setup["student"].put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"quantity": 1}]},
    )
    assert response.status_code == 409
    with pytest.raises(ValueError, match="已截止販售"):
        await shop_svc.create_direct_order(
            db_session,
            user_id=setup["buyer"].id,
            class_id=None,
            data=ClassOrderUpsert(
                user_id=setup["buyer"].id,
                items=[OrderItemCreate(product_id=product.id, quantity=1)],
            ),
        )


async def test_cart_becomes_unavailable_after_product_deadline(db_session, deadline_setup):
    setup = deadline_setup
    product = setup["product"]
    product.sale_end = datetime.now(UTC) + timedelta(days=1)
    await shop_svc.add_cart_item(
        db_session,
        setup["buyer"].id,
        data=CartItemCreate(product_id=product.id, quantity=1),
    )
    product.sale_end = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()
    cart = await shop_svc.get_or_create_cart(db_session, setup["buyer"].id)
    assert shop_svc.serialize_cart(cart).items[0].available is False


async def test_recently_closed_products_uses_only_product_deadlines(db_session, deadline_setup):
    setup = deadline_setup
    product = setup["product"]
    now = datetime.now(UTC)
    product.sale_end = now - timedelta(minutes=3)
    other = await shop_svc.create_product(
        db_session,
        data=ProductCreate(
            category_id=setup["category"].id,
            name="較早截止商品",
            price=100,
            stock_quantity=20,
        ),
        created_by=product.created_by,
    )
    await shop_svc.activate_product(db_session, other)
    other.sale_end = now - timedelta(minutes=7)
    await db_session.flush()
    assert await recently_closed_product_ids(db_session, now=now) == [product.id]
