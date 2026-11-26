"""商品分類結單與公開目錄行為。"""

from api.main import app
from api.schemas.shop import (
    ClassOrderUpsert,
    OrderItemCreate,
    ProductCategoryCreate,
    ProductCreate,
)
from api.services import shop as shop_svc


async def test_activity_api_is_removed(client):
    paths = app.openapi()["paths"]
    assert not any(path.startswith("/shop/activities") for path in paths)
    response = await client.get("/shop/activities")
    assert response.status_code == 404


async def test_category_closure_hides_public_catalog_and_preserves_orders(
    db_session, client, admin_user, authed_client_factory, make_user
):
    buyer = await make_user(student_id="310001", email="310001@hchs.hc.edu.tw")
    category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="校慶商品"), created_by=admin_user.id
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(
            category_id=category.id,
            name="紀念袋",
            price=100,
            stock_quantity=10,
        ),
        created_by=admin_user.id,
    )
    await shop_svc.activate_product(db_session, product)
    order = (
        await shop_svc.create_direct_order(
            db_session,
            user_id=buyer.id,
            class_id=None,
            data=ClassOrderUpsert(
                user_id=buyer.id,
                items=[OrderItemCreate(product_id=product.id, quantity=1)],
            ),
        )
    )[0]
    manager = authed_client_factory(admin_user)
    path = f"/shop/categories/{category.id}/close"

    closed = await manager.post(path, json={})
    assert closed.status_code == 201, closed.text
    assert closed.json()["category_id"] == str(category.id)
    assert closed.json()["class_id"] is None
    assert (await client.get("/shop/catalog")).json() == []
    status = await shop_svc.get_close_status(db_session, [category.id], None)
    assert status[category.id] is not None and status[category.id].is_global
    assert await shop_svc.get_order(db_session, order.id) is not None

    reopened = await manager.delete(path)
    assert reopened.status_code == 200, reopened.text
    assert (await client.get("/shop/catalog")).json()[0]["id"] == str(category.id)
    assert await shop_svc.get_order(db_session, order.id) is not None


async def test_closure_requires_council_permission(
    client, db_session, member_user, authed_client_factory
):
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="管理權限測試"),
        created_by=member_user.id,
    )
    path = f"/shop/categories/{category.id}/close"
    assert (await client.post(path, json={})).status_code == 401
    assert (await client.delete(path)).status_code == 401
    member = authed_client_factory(member_user)
    assert (await member.post(path, json={})).status_code == 403
    assert (await member.delete(path)).status_code == 403
