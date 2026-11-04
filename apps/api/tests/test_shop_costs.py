"""內部成本的授權、公開回應隔離與 PATCH 語意。"""

import pytest
from sqlalchemy.exc import IntegrityError

from api.core.clock import local_today
from api.models.activity import Activity, ActivityConvener
from api.models.shop import ProductStatus
from api.schemas.shop import ProductCategoryCreate
from api.services import shop as shop_svc


@pytest.fixture
async def cost_product(db_session, admin_user, authed_client_factory):
    category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="成本測試"), created_by=admin_user.id
    )
    admin = authed_client_factory(admin_user)
    result = await admin.post(
        "/shop/products",
        json={"category_id": str(category.id), "name": "商品", "price": 100, "unit_cost": 60},
    )
    assert result.status_code == 201, result.text
    assert "unit_cost" not in result.json()
    product = await shop_svc.get_product(db_session, result.json()["id"])
    product.status = ProductStatus.ACTIVE
    await db_session.flush()
    return admin, product


async def test_cost_read_write_is_private_and_patch_preserves_null_and_zero(
    cost_product, client, make_user, authed_client_factory
):
    admin, product = cost_product
    path = f"/shop/products/{product.id}"
    assert (await client.get(f"{path}/cost")).status_code == 401
    assert (await client.patch(path, json={"unit_cost": 1})).status_code == 401
    for _ in range(2):
        other = authed_client_factory(await make_user())
        assert (await other.get(f"{path}/cost")).status_code == 403
        assert (await other.patch(path, json={"unit_cost": 1})).status_code == 403
        assert "unit_cost" not in (await other.get(path)).json()
    private = await admin.get(f"{path}/cost")
    assert private.json() == {"unit_cost": 60}
    assert private.headers["cache-control"] == "private, no-store"
    assert (await admin.patch(path, json={"name": "改名"})).status_code == 200
    assert (await admin.get(f"{path}/cost")).json() == {"unit_cost": 60}
    for cost in (0, None, 120):
        result = await admin.patch(path, json={"unit_cost": cost})
        assert result.status_code == 200, result.text
        assert "unit_cost" not in result.json()
        assert (await admin.get(f"{path}/cost")).json() == {"unit_cost": cost}
    for response in [await client.get(path), await client.get("/shop/products")]:
        assert response.status_code == 200
        assert "unit_cost" not in response.text
    catalog = await client.get("/shop/catalog")
    assert catalog.status_code == 200
    assert "unit_cost" not in catalog.text


@pytest.mark.parametrize("value", [-1, 1.5, 2147483648])
async def test_invalid_unit_cost_rejected(cost_product, value):
    admin, product = cost_product
    assert (
        await admin.patch(f"/shop/products/{product.id}", json={"unit_cost": value})
    ).status_code == 422
    result = await admin.post(
        "/shop/products",
        json={
            "category_id": str(product.category_id),
            "name": "錯誤成本",
            "price": 100,
            "unit_cost": value,
        },
    )
    assert result.status_code == 422


async def test_database_rejects_negative_cost(cost_product, db_session):
    _, product = cost_product
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            product.unit_cost = -1
            await db_session.flush()


@pytest.mark.parametrize("product_status", list(ProductStatus))
async def test_cost_can_be_updated_in_every_status_without_changing_status_or_stock(
    cost_product, db_session, product_status
):
    admin, product = cost_product
    product.status = product_status
    stock = product.stock_quantity
    await db_session.flush()
    result = await admin.patch(
        f"/shop/products/{product.id}",
        json={
            "unit_cost": 75,
            "name": product.name,
            "price": product.price,
            "stock_quantity": stock,
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["status"] == product_status.value
    assert result.json()["stock_quantity"] == stock
    assert (await admin.get(f"/shop/products/{product.id}/cost")).json() == {"unit_cost": 75}


async def test_activity_manager_cannot_read_or_change_another_activity_cost(
    cost_product, db_session, make_user, authed_client_factory
):
    admin, product = cost_product
    category = await shop_svc.get_category(db_session, product.category_id)
    own, other = Activity(name="自身活動"), Activity(name="其他活動")
    manager = await make_user()
    db_session.add_all([own, other])
    await db_session.flush()
    category.activity_id = own.id
    db_session.add(
        ActivityConvener(activity_id=own.id, user_id=manager.id, start_date=local_today())
    )
    await db_session.flush()
    scoped = authed_client_factory(manager)
    path = f"/shop/products/{product.id}"
    assert (await scoped.get(f"{path}/cost")).json() == {"unit_cost": 60}
    assert (await scoped.patch(path, json={"unit_cost": 50})).status_code == 200
    category.activity_id = other.id
    await db_session.flush()
    assert (await scoped.get(f"{path}/cost")).status_code == 403
    assert (await scoped.patch(path, json={"unit_cost": 1})).status_code == 403
    assert (await admin.get(f"{path}/cost")).json() == {"unit_cost": 50}
