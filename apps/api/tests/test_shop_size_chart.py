"""尺寸表的儲存、公開回應、規格歸屬與 PATCH 授權。"""

import uuid

import pytest

from api.core.clock import local_today
from api.models.activity import Activity, ActivityConvener
from api.schemas.shop import ProductCategoryCreate
from api.services import shop as shop_svc


@pytest.fixture
async def size_product(db_session, admin_user, authed_client_factory):
    category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="尺寸表測試"), created_by=admin_user.id
    )
    admin = authed_client_factory(admin_user)
    response = await admin.post(
        "/shop/products",
        json={
            "category_id": str(category.id),
            "name": "紀念衫",
            "price": 300,
            "is_unlimited": True,
            "variant_groups": [{"name": "尺寸", "options": [{"value": "M"}, {"value": "L"}]}],
        },
    )
    assert response.status_code == 201, response.text
    product = response.json()
    assert product["size_chart"] is None
    group = product["variant_groups"][0]
    chart = {
        "group_id": group["id"],
        "columns": ["衣長（cm）", "胸寬（cm）"],
        "rows": [{"option_id": group["options"][0]["id"], "values": ["68", "50"]}],
        "note": "平放測量",
    }
    return admin, product, chart


async def test_size_chart_roundtrip_preserves_and_clears(size_product, client, db_session):
    admin, product, chart = size_product
    path = f"/shop/products/{product['id']}"
    saved = await admin.patch(path, json={"size_chart": chart})
    assert saved.status_code == 200, saved.text
    assert saved.json()["size_chart"] == chart
    await db_session.refresh(await shop_svc.get_product(db_session, product["id"]))
    assert (await admin.patch(path, json={"name": "新名稱"})).json()["size_chart"] == chart
    assert (await admin.post(f"{path}/activate")).status_code == 200
    for response in (await client.get(path), await client.get("/shop/products")):
        assert response.status_code == 200, response.text
        body = response.json()
        assert (body[0] if isinstance(body, list) else body)["size_chart"] == chart
    renamed = await admin.patch(
        f"/shop/variant-options/{chart['rows'][0]['option_id']}", json={"value": "中號"}
    )
    assert renamed.status_code == 200
    assert (await client.get(path)).json()["size_chart"] == chart
    cleared = await admin.patch(path, json={"size_chart": None})
    assert cleared.status_code == 200
    assert cleared.json()["size_chart"] is None


async def test_size_chart_requires_manager_and_activity_scope(
    size_product, client, db_session, make_user, authed_client_factory
):
    admin, product, chart = size_product
    path = f"/shop/products/{product['id']}"
    assert (await client.patch(path, json={"size_chart": chart})).status_code == 401
    manager = await make_user()
    scoped = authed_client_factory(manager)
    assert (await scoped.patch(path, json={"size_chart": chart})).status_code == 403
    own, other = Activity(name="自身活動"), Activity(name="其他活動")
    db_session.add_all([own, other])
    await db_session.flush()
    category = await shop_svc.get_category(db_session, uuid.UUID(product["category_id"]))
    category.activity_id = own.id
    db_session.add(
        ActivityConvener(activity_id=own.id, user_id=manager.id, start_date=local_today())
    )
    await db_session.flush()
    assert (await scoped.patch(path, json={"size_chart": chart})).status_code == 200
    category.activity_id = other.id
    await db_session.flush()
    assert (await scoped.patch(path, json={"size_chart": None})).status_code == 403
    assert (await admin.get(path)).json()["size_chart"] == chart


@pytest.mark.parametrize("foreign_field", ["group_id", "option_id"])
async def test_size_chart_rejects_options_from_another_product(size_product, foreign_field):
    admin, product, chart = size_product
    other = await admin.post(
        "/shop/products",
        json={
            "category_id": product["category_id"],
            "name": "另一件商品",
            "price": 100,
            "variant_groups": [{"name": "尺寸", "options": [{"value": "M"}]}],
        },
    )
    group = other.json()["variant_groups"][0]
    if foreign_field == "group_id":
        chart["group_id"] = group["id"]
    else:
        chart["rows"][0]["option_id"] = group["options"][0]["id"]
    response = await admin.patch(f"/shop/products/{product['id']}", json={"size_chart": chart})
    assert response.status_code == 409, response.text
    assert (await admin.get(f"/shop/products/{product['id']}")).json()["size_chart"] is None


@pytest.mark.parametrize(
    "invalid",
    [
        {"columns": []},
        {"columns": ["衣長", " 衣長 "]},
        {"columns": [" ", "胸寬"]},
        {"columns": ["衣長"]},
        {"rows": []},
        {"note": "字" * 1001},
        "duplicate_rows",
        "blank_cell",
    ],
)
async def test_size_chart_rejects_malformed_tables(size_product, invalid):
    admin, product, chart = size_product
    if invalid == "duplicate_rows":
        chart["rows"] *= 2
    elif invalid == "blank_cell":
        chart["rows"][0]["values"] = ["68", " "]
    else:
        chart.update(invalid)
    response = await admin.patch(f"/shop/products/{product['id']}", json={"size_chart": chart})
    assert response.status_code == 422, response.text
