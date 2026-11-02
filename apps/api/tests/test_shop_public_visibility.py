"""公開商品入口隱藏特殊資格商品，保留登入與限購行為。"""

from datetime import UTC, datetime, timedelta

import pytest

from api.schemas.shop import (
    ProductCategoryCreate,
    ProductCreate,
    ProductPurchaseRules,
    ProductSeriesCreate,
)
from api.services import shop as shop_svc


@pytest.fixture
async def public_shop(db_session, admin_user, make_user, authed_client_factory):
    buyer = await make_user(student_id="310001", email="g0310001@hchs.hc.edu.tw")
    outsider = await make_user(student_id="310002", email="g0310002@hchs.hc.edu.tw")
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="公開票券"),
        created_by=admin_user.id,
    )
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列票券")
    )

    async def create_product(name, rules=None, *, in_series=False):
        product = await shop_svc.create_product(
            db_session,
            data=ProductCreate(
                category_id=category.id,
                series_id=series.id if in_series else None,
                name=name,
                price=100,
                stock_quantity=20,
                purchase_rules=ProductPurchaseRules.model_validate(rules or {}),
            ),
            created_by=admin_user.id,
        )
        await shop_svc.activate_product(db_session, product)
        return product

    return {
        "create": create_product,
        "category": category,
        "series": series,
        "buyer": authed_client_factory(buyer),
        "outsider": authed_client_factory(outsider),
        "admin": authed_client_factory(admin_user),
    }


def catalog_product_ids(payload):
    return {
        product["id"]
        for category in payload
        for product in category["products"]
        + [product for series in category["series"] for product in series["products"]]
    }


@pytest.mark.parametrize("in_series", [False, True])
@pytest.mark.parametrize(
    "rules",
    [
        {"allowed_grades": [3]},
        {"required_permissions": ["shop:manage"]},
        {"allowed_identifiers": ["310001"]},
        {"blocked_identifiers": ["310002"]},
        {"designated_only": True, "exclusive_group": "活動票券"},
    ],
)
async def test_qualification_products_are_hidden_from_every_anonymous_entry(
    public_shop, client, rules, in_series
):
    ordinary = await public_shop["create"]("一般票", in_series=in_series)
    restricted = await public_shop["create"]("資格限定票", rules, in_series=in_series)

    catalog = await client.get("/shop/catalog")
    assert catalog.status_code == 200
    assert catalog_product_ids(catalog.json()) == {str(ordinary.id)}
    products = await client.get("/shop/products")
    assert products.status_code == 200
    assert [product["id"] for product in products.json()] == [str(ordinary.id)]
    assert (await client.get(f"/shop/products/{restricted.id}")).status_code == 404
    assert (await client.get(f"/shop/products/{ordinary.id}")).status_code == 200

    direct = await client.get(
        "/shop/catalog",
        params=[("direct_path", public_shop["category"].name), ("direct_path", restricted.name)],
    )
    assert direct.status_code == 200
    assert direct.json() == []
    assert restricted.name not in catalog.text + products.text + direct.text


async def test_public_product_pagination_skips_qualifications_before_limit(
    public_shop, client, db_session
):
    older = await public_shop["create"]("早期一般票")
    await public_shop["create"]("名單票", {"allowed_identifiers": ["310001"]})
    newer = await public_shop["create"]("近期一般票", {"exclusive_group": "同組限購"})
    await public_shop["create"]("權限票", {"required_permissions": ["shop:manage"]})
    # PostgreSQL 的交易時間固定，明確區分商品建立時間來驗證分頁順序。
    older.created_at = datetime.now(UTC) - timedelta(days=2)
    newer.created_at = datetime.now(UTC) - timedelta(days=1)
    await db_session.flush()

    for offset, expected in enumerate(([str(newer.id)], [str(older.id)], [])):
        response = await client.get("/shop/products", params={"limit": 1, "offset": offset})
        assert response.status_code == 200
        assert [product["id"] for product in response.json()] == expected


async def test_empty_and_group_only_rules_remain_public(public_shop, client, db_session):
    legacy = await public_shop["create"]("舊版一般票")
    legacy.purchase_rules = {}
    await db_session.flush()
    ordinary = await public_shop["create"]("一般票")
    grouped = await public_shop["create"]("同組限購票", {"exclusive_group": "限購組"})
    expected = {str(product.id) for product in (legacy, ordinary, grouped)}

    assert catalog_product_ids((await client.get("/shop/catalog")).json()) == expected
    assert {product["id"] for product in (await client.get("/shop/products")).json()} == expected
    for product in (legacy, ordinary, grouped):
        assert (await client.get(f"/shop/products/{product.id}")).status_code == 200


async def test_login_keeps_buyer_qualification_checks_and_management_access(public_shop, client):
    product = await public_shop["create"]("名單限定票", {"allowed_identifiers": ["310001"]})
    path = f"/shop/products/{product.id}"
    assert (await client.get(path)).status_code == 404

    for actor, allowed in (("buyer", True), ("outsider", False), ("admin", False)):
        detail = await public_shop[actor].get(path)
        assert detail.status_code == 200
        assert detail.json()["purchase_allowed"] is allowed
        catalog = await public_shop[actor].get("/shop/catalog")
        assert str(product.id) in catalog_product_ids(catalog.json())
        listed = await public_shop[actor].get("/shop/products")
        assert str(product.id) in {item["id"] for item in listed.json()}

    cleared = await public_shop["admin"].patch(path, json={"purchase_rules": None})
    assert cleared.status_code == 200
    assert (await client.get(path)).status_code == 200
    assert str(product.id) in catalog_product_ids((await client.get("/shop/catalog")).json())


async def test_public_promotions_do_not_expose_restricted_product_names(public_shop, client):
    ordinary = await public_shop["create"]("一般票")
    restricted = await public_shop["create"]("特殊名單票", {"allowed_identifiers": ["310001"]})
    promotions = []
    for name, products in (
        ("全店優惠", []),
        ("一般票優惠", [ordinary.id]),
        ("資格票優惠", [restricted.id]),
        ("混合套票優惠", [ordinary.id, restricted.id]),
    ):
        response = await public_shop["admin"].post(
            "/shop/promotions",
            json={
                "name": name,
                "discount_type": "percentage",
                "discount_value": 10,
                "target_product_ids": [str(product_id) for product_id in products],
            },
        )
        assert response.status_code == 201, response.text
        promotions.append(response.json()["id"])

    available = await client.get("/shop/promotions/available")
    assert available.status_code == 200
    assert {promotion["id"] for promotion in available.json()} == set(promotions[:2])
    assert restricted.name not in available.text
    logged_in = await public_shop["buyer"].get("/shop/promotions/available")
    assert logged_in.status_code == 200
    assert {promotion["id"] for promotion in logged_in.json()} == set(promotions)
