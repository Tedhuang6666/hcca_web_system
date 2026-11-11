"""原價呈現與實售價／規格／既有促銷的整合回歸。"""

import pytest

from api.models.electronic_credential import ElectronicCredentialSettings
from api.models.shop import ProductStatus
from api.schemas.shop import ProductCategoryCreate
from api.services import shop as shop_svc


@pytest.fixture
async def pricing(db_session, admin_user, make_user, authed_client_factory):
    db_session.add(ElectronicCredentialSettings(id=1, student_id_prefixes=["115"]))
    category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="原價測試"), created_by=admin_user.id
    )
    buyer = await make_user(student_id="11510", email="g011510@hchs.hc.edu.tw")
    return {
        "admin": authed_client_factory(admin_user),
        "buyer": authed_client_factory(buyer),
        "category": category,
    }


async def create_product(pricing, **changes):
    response = await pricing["admin"].post(
        "/shop/products",
        json={
            "category_id": str(pricing["category"].id),
            "name": "優惠商品",
            "price": 300,
            "original_price": 400,
            "stock_quantity": 50,
            **changes,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_original_prices_roundtrip_all_catalog_shapes(pricing, db_session, client):
    product = await create_product(
        pricing,
        variant_groups=[
            {
                "name": "尺寸",
                "options": [{"value": "XL", "price_delta": 50, "original_price_delta": 100}],
            }
        ],
    )
    assert product["original_price"] == 400
    assert product["variant_groups"][0]["options"][0]["original_price_delta"] == 100
    row = await shop_svc.get_product(db_session, product["id"])
    row.status = ProductStatus.ACTIVE
    await db_session.flush()
    detail = await client.get(f"/shop/products/{product['id']}")
    assert detail.status_code == 200
    assert detail.json()["original_price"] == 400
    listing = await client.get("/shop/products")
    assert listing.json()[0]["original_price"] == 400
    catalog = await client.get("/shop/catalog")
    assert catalog.json()[0]["products"][0]["original_price"] == 400


async def test_product_patch_preserves_clears_and_checks_merged_prices(pricing, client):
    product = await create_product(pricing)
    path = f"/shop/products/{product['id']}"
    assert (await client.patch(path, json={"original_price": 450})).status_code == 401
    assert (await pricing["buyer"].patch(path, json={"original_price": 450})).status_code == 403
    admin = pricing["admin"]
    renamed = await admin.patch(path, json={"name": "新名稱"})
    assert renamed.json()["original_price"] == 400
    for payload in ({"price": 401}, {"original_price": 299}, {"price": 500, "original_price": 450}):
        result = await admin.patch(path, json=payload)
        assert result.status_code == 409, result.text
    assert (await admin.patch(path, json={"price": None})).status_code == 422
    cleared = await admin.patch(path, json={"original_price": None, "price": 500})
    assert cleared.status_code == 200
    assert cleared.json()["original_price"] is None
    assert cleared.json()["price"] == 500


async def test_option_create_group_copy_update_and_free_surcharge(pricing, client):
    product = await create_product(pricing)
    admin = pricing["admin"]
    group = await admin.post(
        f"/shop/products/{product['id']}/variant-groups",
        json={
            "name": "加購",
            "options": [{"value": "贈品", "price_delta": 0, "original_price_delta": 60}],
        },
    )
    assert group.status_code == 201, group.text
    assert group.json()["options"][0]["original_price_delta"] == 60
    option_path = f"/shop/variant-groups/{group.json()['id']}/options"
    payload = {"value": "XL", "price_delta": 50, "original_price_delta": 100}
    assert (await client.post(option_path, json=payload)).status_code == 401
    assert (await pricing["buyer"].post(option_path, json=payload)).status_code == 403
    option = await admin.post(option_path, json=payload)
    assert option.status_code == 201, option.text
    path = f"/shop/variant-options/{option.json()['id']}"
    assert (await client.patch(path, json={"original_price_delta": 110})).status_code == 401
    assert (
        await pricing["buyer"].patch(path, json={"original_price_delta": 110})
    ).status_code == 403
    renamed = await admin.patch(path, json={"value": "大尺寸"})
    assert renamed.json()["original_price_delta"] == 100
    for body in ({"price_delta": 101}, {"original_price_delta": 49}):
        result = await admin.patch(path, json=body)
        assert result.status_code == 400, result.text
    assert (await admin.patch(path, json={"price_delta": None})).status_code == 422
    free = await admin.patch(path, json={"price_delta": 0})
    assert free.json()["original_price_delta"] == 100
    cleared = await admin.patch(path, json={"original_price_delta": None})
    assert cleared.json()["original_price_delta"] is None


@pytest.mark.parametrize(
    "changes",
    [
        {"original_price": 299},
        {"original_price": -1},
        {
            "variant_groups": [
                {
                    "name": "尺寸",
                    "options": [{"value": "XL", "price_delta": 50, "original_price_delta": 49}],
                }
            ]
        },
    ],
)
async def test_invalid_original_prices_rejected_before_persistence(pricing, changes):
    result = await pricing["admin"].post(
        "/shop/products",
        json={"category_id": str(pricing["category"].id), "name": "商品", "price": 300, **changes},
    )
    assert result.status_code == 422, result.text


@pytest.mark.parametrize(
    "discount_type,value,extra,expected",
    [
        ("fixed", 50, {}, 1700),
        ("percentage", 10, {}, 1715),
        ("price_override", 0, {"unit_price": 250}, 1700),
    ],
)
async def test_sale_prices_and_options_stack_with_bundle_and_coupon(
    pricing, discount_type, value, extra, expected
):
    admin, buyer = pricing["admin"], pricing["buyer"]
    shirt = await create_product(
        pricing,
        variant_groups=[
            {
                "name": "尺寸",
                "options": [{"value": "XL", "price_delta": 50, "original_price_delta": 100}],
            }
        ],
    )
    pants = await create_product(pricing, name="長褲", price=500, original_price=600)
    for product in (shirt, pants):
        assert (await admin.post(f"/shop/products/{product['id']}/activate")).status_code == 200
    bundle = await admin.post(
        "/shop/promotions",
        json={
            "name": "衣褲套組",
            "discount_type": "bundle_price",
            "discount_value": 650,
            "target_product_ids": [shirt["id"], pants["id"]],
        },
    )
    assert bundle.status_code == 201, bundle.text
    coupon_body = {
        "name": "加碼",
        "code": "EXTRA",
        "discount_type": discount_type,
        "discount_value": value,
    }
    if extra:
        coupon_body["target_product_ids"] = [shirt["id"]]
        coupon_body["product_price_overrides"] = [{"product_id": shirt["id"], **extra}]
    coupon = await admin.post("/shop/promotions", json=coupon_body)
    assert coupon.status_code == 201, coupon.text
    option_id = shirt["variant_groups"][0]["options"][0]["id"]
    first = await buyer.put(
        f"/shop/registrations/current/products/{shirt['id']}",
        json={
            "variants": [{"option_ids": [option_id], "quantity": 3}],
        },
    )
    assert first.status_code == 200, first.text
    assert first.json()["total_price"] == 1050
    selected = first.json()["items"][0]["selected_options"][0]
    assert selected["price_delta"] == 50
    assert selected["original_price_delta"] == 100
    second = await buyer.put(
        f"/shop/registrations/current/products/{pants['id']}",
        json={
            "variants": [{"option_ids": [], "quantity": 2}],
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["subtotal_price"] == 2050
    assert second.json()["total_price"] == 1750
    final = await buyer.put(
        "/shop/registrations/current/promotion",
        json={"code": "EXTRA", "category_id": str(pricing["category"].id)},
    )
    assert final.status_code == 200, final.text
    assert final.json()["total_price"] == expected
    assert final.json()["discount_amount"] == 2050 - expected
    assert {row["promotion_id"] for row in final.json()["applied_promotions"]} == {
        bundle.json()["id"],
        coupon.json()["id"],
    }
