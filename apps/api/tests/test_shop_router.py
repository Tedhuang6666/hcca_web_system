"""商品訂購系統 Router 層測試 - 涵蓋 HTTP 端點的權限與流程分支。

test_shop_class.py 已涵蓋服務層（班級歸戶／變體計價／結單）；本檔補齊 HTTP 層
（router 權限檢查、404/403/409 分支、報表匯出、結單權限矩陣）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.models.org import Org, Permission, Position, UserPosition
from api.models.outbox import OutboxEvent
from api.models.receivable import Receivable, ReceivableSource
from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductCategory
from api.models.user import User
from api.schemas.school_class import ClassStudentRangeCreate, SchoolClassCreate
from api.schemas.shop import (
    ClassOrderUpsert,
    OrderItemCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductSeriesCreate,
    ProductVariantGroupCreate,
    ProductVariantOptionCreate,
)
from api.services import school_class as class_svc
from api.services import shop as shop_svc

_PNG_BYTES = b"\x89PNG\r\n\x1a\n data"

# ── 測試輔助 ──────────────────────────────────────────────────────────────────


async def _grant_permission(db: AsyncSession, user: User, code: str) -> None:
    """替既有 user 建立一個具備指定權限碼的職位並任命（供 router 權限測試用）。

    get_user_permission_codes 有 180 秒 Redis 快取；若同一 user 在測試中先被判定
    無權限（快取已寫入空集合），這裡直接寫 DB 不會反映到後續請求，必須主動清快取。
    """
    from api.core.cache import cache_invalidate_user_permissions

    org = Org(name=f"org-{uuid.uuid4().hex[:6]}")
    db.add(org)
    await db.flush()
    position = Position(org_id=org.id, name="測試職位")
    db.add(position)
    await db.flush()
    db.add(Permission(position_id=position.id, code=code))
    db.add(UserPosition(user_id=user.id, position_id=position.id, start_date=date.today()))
    await db.flush()
    await cache_invalidate_user_permissions(str(user.id))


async def _make_class(db: AsyncSession, *, start: str = "11501", end: str = "11540", creator=None):
    creator_id = creator.id if creator else (await _bare_user(db)).id
    return await class_svc.create_class(
        db,
        data=SchoolClassCreate(
            academic_year=115,
            class_code=f"c{uuid.uuid4().hex[:4]}",
            grade=1,
            ranges=[ClassStudentRangeCreate(student_id_start=start, student_id_end=end)],
        ),
        created_by=creator_id,
    )


async def _bare_user(db: AsyncSession, *, student_id: str | None = None) -> User:
    user = User(
        email=f"u-{uuid.uuid4().hex[:8]}@school.edu",
        display_name="測試使用者",
        is_active=True,
        is_verified=True,
        student_id=student_id,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_category(
    db: AsyncSession, creator: User, *, activity_id: uuid.UUID | None = None, name: str = "商品"
) -> ProductCategory:
    return await shop_svc.create_category(
        db, data=ProductCategoryCreate(name=name, activity_id=activity_id), created_by=creator.id
    )


async def _make_active_product(
    db: AsyncSession,
    creator: User,
    *,
    price: int = 100,
    stock: int = 50,
    category=None,
    max_quantity_per_user: int | None = None,
):
    category = category or await _make_category(db, creator)
    series = await shop_svc.create_series(
        db, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    product = await shop_svc.create_product(
        db,
        data=ProductCreate(
            series_id=series.id,
            name="商品",
            price=price,
            stock_quantity=stock,
            max_quantity_per_user=max_quantity_per_user,
        ),
        created_by=creator.id,
    )
    return await shop_svc.activate_product(db, product)


# ── 圖片上傳 ──────────────────────────────────────────────────────────────────


async def test_upload_image_without_permission_returns_403(
    client, db_session, member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/images", files={"file": ("a.png", _PNG_BYTES, "image/png")})
    assert resp.status_code == 403


async def test_upload_image_with_permission_succeeds(
    db_session, member_user, authed_client_factory, monkeypatch, tmp_path
) -> None:
    from api.services.storage import LocalStorageBackend

    await _grant_permission(db_session, member_user, "shop:manage")
    monkeypatch.setattr(
        "api.routers.shop.get_storage", lambda: LocalStorageBackend(base_dir=str(tmp_path))
    )
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/images", files={"file": ("a.png", _PNG_BYTES, "image/png")})
    assert resp.status_code == 200
    assert resp.json()["url"]


# ── 主題（分類）────────────────────────────────────────────────────────────────


async def test_list_categories_requires_login_only(
    client, db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    await _make_category(db_session, creator)
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/categories")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_public_catalog_does_not_require_login(client, db_session, member_user) -> None:
    product = await _make_active_product(db_session, member_user, price=80)

    response = await client.get("/shop/catalog")
    assert response.status_code == 200
    assert response.json()[0]["series"][0]["products"][0]["id"] == str(product.id)

    detail = await client.get(f"/shop/products/{product.id}")
    assert detail.status_code == 200


async def test_create_category_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/categories", json={"name": "測試主題"})
    assert resp.status_code == 403


async def test_create_category_with_permission_returns_201(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/categories", json={"name": "測試主題"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "測試主題"


async def test_update_category_unknown_id_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/shop/categories/{uuid.uuid4()}", json={"name": "改名"})
    assert resp.status_code == 404


async def test_delete_category_with_series_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/categories/{category.id}")
    assert resp.status_code == 409


async def test_delete_empty_category_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/categories/{category.id}")
    assert resp.status_code == 204


# ── 系列 ──────────────────────────────────────────────────────────────────────


async def test_create_series_unknown_category_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/series", json={"category_id": str(uuid.uuid4()), "name": "系列"})
    assert resp.status_code == 404


async def test_update_series_unknown_id_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/shop/series/{uuid.uuid4()}", json={"name": "改名"})
    assert resp.status_code == 404


async def test_delete_series_with_product_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    await shop_svc.create_product(
        db_session,
        data=ProductCreate(series_id=series.id, name="商品", price=10),
        created_by=member_user.id,
    )
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/series/{series.id}")
    assert resp.status_code == 409


# ── 購買頁瀏覽樹 ──────────────────────────────────────────────────────────────


async def test_get_catalog_lists_active_products(
    db_session, member_user, authed_client_factory
) -> None:
    await _make_active_product(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/catalog")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["series"][0]["products"][0]["status"] == "active"


async def test_list_products_includes_purchase_limit(db_session, member_user, client) -> None:
    product = await _make_active_product(db_session, member_user, max_quantity_per_user=2)

    response = await client.get("/shop/products")

    assert response.status_code == 200
    listed = next(item for item in response.json() if item["id"] == str(product.id))
    assert listed["max_quantity_per_user"] == 2


# ── 商品 ──────────────────────────────────────────────────────────────────────


async def test_get_product_unknown_id_returns_404(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/shop/products/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_create_product_unknown_series_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        "/shop/products",
        json={"series_id": str(uuid.uuid4()), "name": "商品", "price": 10},
    )
    assert resp.status_code == 404


async def test_create_product_without_permission_returns_403(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    category = await _make_category(db_session, creator)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        "/shop/products",
        json={"series_id": str(series.id), "name": "商品", "price": 10},
    )
    assert resp.status_code == 403


async def test_product_lifecycle_activate_and_deactivate(
    db_session, member_user, authed_client_factory
) -> None:
    """草稿 → 上架 → 下架的完整流程，並驗證不合法的狀態轉移回傳 409。"""
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    ac = authed_client_factory(member_user)
    created = await ac.post(
        "/shop/products",
        json={"series_id": str(series.id), "name": "商品", "price": 10, "stock_quantity": 5},
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    assert created.json()["status"] == "draft"

    # 草稿狀態下不可下架
    bad_deactivate = await ac.post(f"/shop/products/{product_id}/deactivate")
    assert bad_deactivate.status_code == 409

    activated = await ac.post(f"/shop/products/{product_id}/activate")
    assert activated.status_code == 200
    assert activated.json()["status"] == "active"

    # 已上架不可重複上架
    bad_activate = await ac.post(f"/shop/products/{product_id}/activate")
    assert bad_activate.status_code == 409

    updated = await ac.patch(f"/shop/products/{product_id}", json={"price": 20})
    assert updated.status_code == 200
    assert updated.json()["price"] == 20

    deactivated = await ac.post(f"/shop/products/{product_id}/deactivate")
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "cancelled"


async def test_update_product_allowed_for_activity_convener_without_shop_manage(
    db_session, member_user, authed_client_factory
) -> None:
    """驗證 _require_shop_manager 的第二條路徑：活動總召可管理自己活動下的商品，不需要 shop:manage。"""
    creator = await _bare_user(db_session)
    org = Org(name="活動部")
    activity = Activity(name="園遊會", org=org, status=ActivityStatus.ACTIVE)
    db_session.add_all([org, activity])
    await db_session.flush()
    convener = ActivityConvener(
        activity_id=activity.id,
        user_id=member_user.id,
        start_date=date.today() - timedelta(days=1),
    )
    db_session.add(convener)
    await db_session.flush()

    category = await _make_category(db_session, creator, activity_id=activity.id)
    product = await _make_active_product(db_session, creator, category=category)

    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/shop/products/{product.id}", json={"price": 999})
    assert resp.status_code == 200
    assert resp.json()["price"] == 999


# ── 變體群組 / 選項 ───────────────────────────────────────────────────────────


async def test_variant_group_and_option_crud_requires_manage_permission(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    category = await _make_category(db_session, creator)
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(series_id=series.id, name="商品", price=10),
        created_by=creator.id,
    )

    ac = authed_client_factory(member_user)
    forbidden = await ac.post(f"/shop/products/{product.id}/variant-groups", json={"name": "顏色"})
    assert forbidden.status_code == 403

    await _grant_permission(db_session, member_user, "shop:manage")
    group_resp = await ac.post(f"/shop/products/{product.id}/variant-groups", json={"name": "顏色"})
    assert group_resp.status_code == 201
    group_id = group_resp.json()["id"]

    updated_group = await ac.patch(f"/shop/variant-groups/{group_id}", json={"name": "色系"})
    assert updated_group.status_code == 200
    assert updated_group.json()["name"] == "色系"

    option_resp = await ac.post(f"/shop/variant-groups/{group_id}/options", json={"value": "黑"})
    assert option_resp.status_code == 201
    option_id = option_resp.json()["id"]

    updated_option = await ac.patch(f"/shop/variant-options/{option_id}", json={"price_delta": 30})
    assert updated_option.status_code == 200
    assert updated_option.json()["price_delta"] == 30

    deleted_option = await ac.delete(f"/shop/variant-options/{option_id}")
    assert deleted_option.status_code == 204

    deleted_group = await ac.delete(f"/shop/variant-groups/{group_id}")
    assert deleted_group.status_code == 204


# ── 商品登記 ──────────────────────────────────────────────────────────────────


async def test_cart_and_checkout_routes_are_removed(client) -> None:
    assert (await client.get("/shop/cart")).status_code == 404
    assert (await client.post("/shop/cart/checkout", json={})).status_code == 404


async def test_current_registration_requires_login(client) -> None:
    assert (await client.get("/shop/registrations/current")).status_code == 401
    assert (
        await client.post("/shop/registrations/current/promotion/preview", json={"code": None})
    ).status_code == 401
    assert (
        await client.put("/shop/registrations/current/promotion", json={"code": "SAVE50"})
    ).status_code == 401
    assert (
        await client.put(
            f"/shop/registrations/current/products/{uuid.uuid4()}",
            json={"variants": []},
        )
    ).status_code == 401


async def test_current_registration_is_scoped_to_authenticated_user(
    db_session, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    owner = await _bare_user(db_session)
    other_user = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=50, stock=5)
    owner_client = authed_client_factory(owner)
    other_client = authed_client_factory(other_user)

    owner_saved = await owner_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert owner_saved.status_code == 200
    assert (await other_client.get("/shop/registrations/current")).json() is None

    other_saved = await other_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert other_saved.status_code == 200
    assert other_saved.json()["id"] != owner_saved.json()["id"]
    assert (await owner_client.get("/shop/registrations/current")).json()[
        "id"
    ] == owner_saved.json()["id"]
    assert (await other_client.get("/shop/registrations/current")).json()[
        "id"
    ] == other_saved.json()["id"]


async def test_registration_is_saved_and_can_be_changed_or_removed(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=50, stock=5)
    group = await shop_svc.add_variant_group(
        db_session,
        product,
        data=ProductVariantGroupCreate(
            name="尺寸",
            options=[
                ProductVariantOptionCreate(value="標準"),
                ProductVariantOptionCreate(value="加大", price_delta=25),
            ],
        ),
    )
    standard_option, large_option = group.options
    ac = authed_client_factory(member_user)

    empty = await ac.get("/shop/registrations/current")
    assert empty.status_code == 200
    assert empty.json() is None

    added = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [str(standard_option.id)], "quantity": 2}]},
    )
    assert added.status_code == 200
    order = added.json()
    assert order["total_price"] == 100
    assert order["items"][0]["quantity"] == 2
    assert product.stock_quantity == 3

    updated = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [str(large_option.id)], "quantity": 3}]},
    )
    assert updated.status_code == 200
    assert updated.json()["total_price"] == 225
    assert updated.json()["items"][0]["quantity"] == 3
    assert updated.json()["items"][0]["selected_options"][0]["option_id"] == str(large_option.id)
    assert product.stock_quantity == 2

    removed = await ac.put(
        f"/shop/registrations/current/products/{product.id}", json={"variants": []}
    )
    assert removed.status_code == 200
    assert removed.json()["status"] == "cancelled"
    assert removed.json()["items"] == []
    assert product.stock_quantity == 5
    assert (await ac.get("/shop/registrations/current")).json() is None


async def test_registration_enforces_purchase_limit_and_sale_deadline(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    limited = await _make_active_product(
        db_session, creator, price=50, stock=5, max_quantity_per_user=2
    )
    ac = authed_client_factory(member_user)
    saved = await ac.put(
        f"/shop/registrations/current/products/{limited.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert saved.status_code == 200
    too_many = await ac.put(
        f"/shop/registrations/current/products/{limited.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert too_many.status_code == 422
    assert "每人限購 2 件" in too_many.json()["detail"]

    expired = await _make_active_product(db_session, creator)
    expired.sale_end = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.flush()
    closed = await ac.put(
        f"/shop/registrations/current/products/{expired.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert closed.status_code == 409
    assert "已截止登記" in closed.json()["detail"]


async def test_registration_automatically_applies_account_item_quantity_promotion(
    db_session, client, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    other_buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=100, stock=20)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)

    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "指定帳號三件優惠",
            "target_identifiers": [buyer.email],
            "target_product_ids": [str(product.id)],
            "min_quantity": 3,
            "discount_type": "percentage",
            "discount_value": 20,
            "min_order_price": 0,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]

    public_response = await client.get("/shop/promotions/available")
    assert public_response.status_code == 200
    assert public_response.json() == []
    buyer_client = authed_client_factory(buyer)
    buyer_promotions = await buyer_client.get("/shop/promotions/available")
    assert buyer_promotions.status_code == 200
    assert [row["id"] for row in buyer_promotions.json()] == [promotion_id]
    assert "target_users" not in buyer_promotions.json()[0]
    assert "email" not in str(buyer_promotions.json()[0])
    assert (await authed_client_factory(other_buyer).get("/shop/promotions/available")).json() == []

    two_items = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert two_items.status_code == 200
    assert two_items.json()["discount_amount"] == 0
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": None}
    )
    assert preview.status_code == 200
    assert preview.json()["reason_code"] == "quantity_not_met"
    assert preview.json()["quantity_shortfall"] == 1

    three_items = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert three_items.status_code == 200
    assert three_items.json()["promotion_id"] == promotion_id
    assert three_items.json()["discount_amount"] == 60
    assert three_items.json()["total_price"] == 240

    outsider_order = await authed_client_factory(other_buyer).put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert outsider_order.status_code == 200
    assert outsider_order.json()["discount_amount"] == 0


async def test_shop_manager_can_edit_and_delete_unused_promotion(
    db_session, authed_client_factory
) -> None:
    manager = await _bare_user(db_session)
    outsider = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    outsider_client = authed_client_factory(outsider)

    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "原優惠名稱",
            "code": "SAVE10",
            "discount_type": "percentage",
            "discount_value": 10,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]

    forbidden = await outsider_client.delete(f"/shop/promotions/{promotion_id}")
    assert forbidden.status_code == 403

    updated = await manager_client.patch(
        f"/shop/promotions/{promotion_id}",
        json={"name": "更新後名稱", "code": "SAVE20", "discount_value": 20},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "更新後名稱"
    assert updated.json()["code"] == "SAVE20"
    assert updated.json()["discount_value"] == 20

    deleted = await manager_client.delete(f"/shop/promotions/{promotion_id}")
    assert deleted.status_code == 204
    missing = await manager_client.delete(f"/shop/promotions/{promotion_id}")
    assert missing.status_code == 404
    remaining = await manager_client.get("/shop/promotions?include_inactive=true")
    assert remaining.status_code == 200
    assert all(row["id"] != promotion_id for row in remaining.json())


async def test_public_coupon_requires_product_bundle_spend_and_quantity(
    db_session, client, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    first = await _make_active_product(db_session, creator, price=100, stock=20)
    second = await _make_active_product(db_session, creator, price=100, stock=20)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "雙品滿件消費優惠",
            "target_product_ids": [str(first.id), str(second.id)],
            "code": "PAIR50",
            "min_quantity": 2,
            "min_order_price": 450,
            "discount_type": "fixed",
            "discount_value": 50,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]
    available = await client.get("/shop/promotions/available")
    assert available.status_code == 200
    assert available.json()[0]["code"] == "PAIR50"
    assert len(available.json()[0]["target_products"]) == 2

    buyer_client = authed_client_factory(buyer)
    first_only = await buyer_client.put(
        f"/shop/registrations/current/products/{first.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert first_only.status_code == 200
    missing_item = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "pair50"}
    )
    assert missing_item.status_code == 200
    assert missing_item.json()["reason_code"] == "items_not_matched"

    both_items = await buyer_client.put(
        f"/shop/registrations/current/products/{second.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert both_items.status_code == 200
    below_spend = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "PAIR50"}
    )
    assert below_spend.json()["reason_code"] == "minimum_not_met"
    assert below_spend.json()["shortfall"] == 50

    enough_spend = await buyer_client.put(
        f"/shop/registrations/current/products/{first.id}",
        json={"variants": [{"option_ids": [], "quantity": 3}]},
    )
    assert enough_spend.status_code == 200
    eligible = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "pair50"}
    )
    assert eligible.json()["eligible"] is True
    assert eligible.json()["discount_amount"] == 50
    applied = await buyer_client.put(
        "/shop/registrations/current/promotion", json={"code": "pair50"}
    )
    assert applied.status_code == 200
    assert applied.json()["promotion_code"] == "PAIR50"
    assert applied.json()["discount_amount"] == 50
    assert applied.json()["total_price"] == 450

    cannot_delete_used = await manager_client.delete(f"/shop/promotions/{promotion_id}")
    assert cannot_delete_used.status_code == 409
    assert "使用紀錄" in cannot_delete_used.json()["detail"]


async def test_hidden_coupon_is_omitted_from_public_list_but_can_be_redeemed(
    db_session, client, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    outsider = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=100, stock=10)
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    created = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "隱藏彩蛋優惠",
            "code": "EASTER20",
            "discount_type": "percentage",
            "discount_value": 20,
            "is_public": False,
        },
    )
    assert created.status_code == 201
    promotion_id = created.json()["id"]
    assert created.json()["is_public"] is False
    assert (await client.get("/shop/promotions/available")).json() == []

    forbidden = await authed_client_factory(outsider).patch(
        f"/shop/promotions/{promotion_id}", json={"is_public": True}
    )
    assert forbidden.status_code == 403

    buyer_client = authed_client_factory(buyer)
    registered = await buyer_client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert registered.status_code == 200
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview", json={"code": "EASTER20"}
    )
    assert preview.status_code == 200
    assert preview.json()["eligible"] is True
    assert preview.json()["discount_amount"] == 20
    applied = await buyer_client.put(
        "/shop/registrations/current/promotion", json={"code": "EASTER20"}
    )
    assert applied.status_code == 200
    assert applied.json()["promotion_code"] == "EASTER20"
    assert applied.json()["discount_amount"] == 20

    null_visibility = await manager_client.patch(
        f"/shop/promotions/{promotion_id}", json={"is_public": None}
    )
    assert null_visibility.status_code == 422

    published = await manager_client.patch(
        f"/shop/promotions/{promotion_id}", json={"is_public": True}
    )
    assert published.status_code == 200
    assert published.json()["is_public"] is True
    available = await buyer_client.get("/shop/promotions/available")
    assert [row["id"] for row in available.json()] == [promotion_id]


async def test_activity_orders_keep_separate_and_stack_scoped_coupon_with_automatic_discount(
    db_session, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session, student_id="11510")
    manager = await _bare_user(db_session)
    school_class = await _make_class(db_session)
    org = Org(name=f"活動-{uuid.uuid4().hex[:6]}")
    first_activity = Activity(name="校慶預購", org=org, status=ActivityStatus.ACTIVE)
    second_activity = Activity(name="社團活動", org=org, status=ActivityStatus.ACTIVE)
    db_session.add_all([org, first_activity, second_activity])
    await db_session.flush()
    card_category = await _make_category(
        db_session, creator, activity_id=first_activity.id, name="卡片"
    )
    hat_category = await _make_category(
        db_session, creator, activity_id=first_activity.id, name="帽子"
    )
    other_category = await _make_category(
        db_session, creator, activity_id=second_activity.id, name="社團商品"
    )
    cards = await _make_active_product(db_session, creator, price=40, category=card_category)
    hats = await _make_active_product(db_session, creator, price=999, category=hat_category)
    other_product = await _make_active_product(
        db_session, creator, price=100, category=other_category
    )
    catalog = await authed_client_factory(buyer).get("/shop/catalog")
    assert catalog.status_code == 200
    assert {row["activity_name"] for row in catalog.json()} == {"校慶預購", "社團活動"}
    await _grant_permission(db_session, manager, "shop:manage")
    manager_client = authed_client_factory(manager)
    auto = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "第二件折抵",
            "target_product_ids": [str(hats.id)],
            "min_quantity": 2,
            "discount_type": "fixed",
            "discount_value": 20,
        },
    )
    assert auto.status_code == 201
    assert auto.json()["activity_id"] == str(first_activity.id)
    coupon = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "校慶九折",
            "activity_id": str(first_activity.id),
            "code": "FESTIVAL10",
            "discount_type": "percentage",
            "discount_value": 10,
            "min_order_price": 1000,
        },
    )
    assert coupon.status_code == 201

    buyer_client = authed_client_factory(buyer)
    card_order = await buyer_client.put(
        f"/shop/registrations/current/products/{cards.id}",
        json={"variants": [{"option_ids": [], "quantity": 4}]},
    )
    assert card_order.status_code == 200
    hat_order = await buyer_client.put(
        f"/shop/registrations/current/products/{hats.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert hat_order.status_code == 200
    assert hat_order.json()["activity_id"] == str(first_activity.id)
    assert hat_order.json()["discount_amount"] == 20
    preview = await buyer_client.post(
        "/shop/registrations/current/promotion/preview",
        json={"code": "FESTIVAL10", "activity_id": str(first_activity.id)},
    )
    assert preview.status_code == 200
    assert preview.json()["discount_amount"] == 235
    assert preview.json()["total_price"] == 1923
    applied = await buyer_client.put(
        "/shop/registrations/current/promotion",
        json={"code": "FESTIVAL10", "activity_id": str(first_activity.id)},
    )
    assert applied.status_code == 200
    assert applied.json()["discount_amount"] == 235
    assert applied.json()["total_price"] == 1923
    assert {row["promotion_id"] for row in applied.json()["applied_promotions"]} == {
        auto.json()["id"],
        coupon.json()["id"],
    }

    other_order = await buyer_client.put(
        f"/shop/registrations/current/products/{other_product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert other_order.status_code == 200
    assert other_order.json()["id"] != applied.json()["id"]
    mismatch = await buyer_client.post(
        "/shop/registrations/current/promotion/preview",
        json={"code": "FESTIVAL10", "activity_id": str(second_activity.id)},
    )
    assert mismatch.status_code == 200
    assert mismatch.json()["reason_code"] == "activity_not_matched"

    registrations = await buyer_client.get("/shop/registrations")
    assert registrations.status_code == 200
    assert {row["activity_id"] for row in registrations.json()} == {
        str(first_activity.id),
        str(second_activity.id),
    }
    by_activity = {row["activity_name"]: row for row in registrations.json()}
    assert {item["product_id"]: item["quantity"] for item in by_activity["校慶預購"]["items"]} == {
        str(cards.id): 4,
        str(hats.id): 2,
    }
    listed = await buyer_client.get("/shop/orders", params={"my_only": "true"})
    assert listed.status_code == 200
    assert {row["activity_name"] for row in listed.json()} == {"校慶預購", "社團活動"}
    listed_by_activity = {row["activity_name"]: row for row in listed.json()}
    assert {
        item["product_id"]: item["quantity"] for item in listed_by_activity["校慶預購"]["items"]
    } == {
        str(cards.id): 4,
        str(hats.id): 2,
    }
    first_order_id = applied.json()["id"]
    second_order_id = other_order.json()["id"]
    first_order = await shop_svc.get_order(db_session, uuid.UUID(first_order_id))
    second_order = await shop_svc.get_order(db_session, uuid.UUID(second_order_id))
    assert first_order is not None and second_order is not None
    await shop_svc.set_class_collected(
        db_session, second_order, collected=True, actor_id=manager.id
    )
    assert first_order.is_class_collected is False
    assert second_order.is_class_collected is True

    first_paid = await manager_client.patch(
        f"/shop/orders/classes/{school_class.id}/payment",
        json={"is_paid": True, "activity_id": str(first_activity.id)},
    )
    assert first_paid.status_code == 200
    assert first_paid.json()["updated_orders"] == 1
    await db_session.refresh(first_order)
    await db_session.refresh(second_order)
    assert first_order.is_paid is True
    assert second_order.is_paid is False
    second_paid = await manager_client.patch(
        f"/shop/orders/classes/{school_class.id}/payment",
        json={"is_paid": True, "activity_id": str(second_activity.id)},
    )
    assert second_paid.status_code == 200
    await db_session.refresh(second_order)
    assert second_order.is_paid is True


async def test_direct_class_order_splits_items_across_activities(db_session) -> None:
    creator = await _bare_user(db_session)
    buyer = await _bare_user(db_session)
    org = Org(name=f"活動-{uuid.uuid4().hex[:6]}")
    first_activity = Activity(name="活動一", org=org, status=ActivityStatus.ACTIVE)
    second_activity = Activity(name="活動二", org=org, status=ActivityStatus.ACTIVE)
    db_session.add_all([org, first_activity, second_activity])
    await db_session.flush()
    first_product = await _make_active_product(
        db_session,
        creator,
        category=await _make_category(db_session, creator, activity_id=first_activity.id),
    )
    second_product = await _make_active_product(
        db_session,
        creator,
        category=await _make_category(db_session, creator, activity_id=second_activity.id),
    )
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=buyer.id,
        class_id=None,
        data=ClassOrderUpsert(
            user_id=buyer.id,
            items=[
                OrderItemCreate(product_id=first_product.id, quantity=1, option_ids=[]),
                OrderItemCreate(product_id=second_product.id, quantity=1, option_ids=[]),
            ],
        ),
    )
    assert len(orders) == 2
    assert {order.activity_id for order in orders} == {first_activity.id, second_activity.id}
    full_orders = [await shop_svc.get_order(db_session, order.id) for order in orders]
    assert all(order is not None and len(order.items) == 1 for order in full_orders)


async def test_product_cannot_be_deleted_while_used_by_promotion(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator)
    await _grant_permission(db_session, member_user, "shop:manage")
    manager_client = authed_client_factory(member_user)
    promotion = await manager_client.post(
        "/shop/promotions",
        json={
            "name": "指定商品優惠",
            "target_product_ids": [str(product.id)],
            "discount_type": "fixed",
            "discount_value": 10,
            "min_order_price": 0,
        },
    )
    assert promotion.status_code == 201

    deleted = await manager_client.delete(f"/shop/products/{product.id}")
    assert deleted.status_code == 409
    assert "先從優惠" in deleted.json()["detail"]


async def test_class_collection_locks_user_registration(db_session, authed_client_factory) -> None:
    school_class = await _make_class(db_session, start="11501", end="11540")
    buyer = await _bare_user(db_session, student_id="11510")
    creator = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=50)
    ac = authed_client_factory(buyer)
    created = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert created.status_code == 200
    order_id = uuid.UUID(created.json()["id"])
    order = await shop_svc.get_order(db_session, order_id)
    assert order is not None and order.class_id == school_class.id
    await shop_svc.set_class_collected(db_session, order, collected=True, actor_id=buyer.id)

    locked = await ac.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 2}]},
    )
    assert locked.status_code == 409
    assert "登記收款" in locked.json()["detail"]


# ── 訂單 ──────────────────────────────────────────────────────────────────────


async def _seed_order(
    db: AsyncSession, buyer: User, *, class_id=None, total_price: int = 100, is_paid: bool = False
) -> Order:
    order = Order(
        serial_number=f"ORD-TEST-{uuid.uuid4().hex[:8]}",
        user_id=buyer.id,
        class_id=class_id,
        status=OrderStatus.PENDING,
        total_price=total_price,
        is_paid=is_paid,
    )
    db.add(order)
    await db.flush()
    return order


async def test_list_orders_defaults_to_own_orders_only(db_session, authed_client_factory) -> None:
    owner = await _bare_user(db_session)
    other = await _bare_user(db_session)
    await _seed_order(db_session, owner)
    await _seed_order(db_session, other)

    ac = authed_client_factory(owner)
    resp = await ac.get("/shop/orders")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["user_id"] == str(owner.id)


async def test_list_orders_admin_view_sees_all_orders(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:view_all")
    other = await _bare_user(db_session)
    await _seed_order(db_session, other)
    await _seed_order(db_session, member_user)

    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders", params={"my_only": "false"})
    assert resp.status_code == 200
    assert len(resp.json()) == 2

    mine = await ac.get("/shop/orders")
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0]["user_id"] == str(member_user.id)


async def test_get_order_hidden_for_unrelated_user_returns_404(
    db_session, authed_client_factory
) -> None:
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(stranger)
    resp = await ac.get(f"/shop/orders/{order.id}")
    assert resp.status_code == 404


async def test_get_order_visible_to_owner(db_session, authed_client_factory) -> None:
    owner = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(owner)
    resp = await ac.get(f"/shop/orders/{order.id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == str(order.id)


async def test_cancel_order_by_unrelated_user_returns_403(
    db_session, authed_client_factory
) -> None:
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(stranger)
    resp = await ac.post(f"/shop/orders/{order.id}/cancel", json={})
    assert resp.status_code == 403


async def test_cancel_order_twice_returns_409(db_session, authed_client_factory) -> None:
    owner = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(owner)
    first = await ac.post(f"/shop/orders/{order.id}/cancel", json={"reason": "不需要了"})
    assert first.status_code == 200
    assert first.json()["status"] == "cancelled"

    second = await ac.post(f"/shop/orders/{order.id}/cancel", json={})
    assert second.status_code == 409


async def test_update_order_items_by_unrelated_user_returns_403(
    db_session, authed_client_factory
) -> None:
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    product = await _make_active_product(db_session, owner, price=10)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(stranger)
    resp = await ac.patch(
        f"/shop/orders/{order.id}",
        json={
            "user_id": str(owner.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert resp.status_code == 403


async def test_update_order_items_by_owner_succeeds(db_session, authed_client_factory) -> None:
    owner = await _bare_user(db_session)
    product = await _make_active_product(db_session, owner, price=10, stock=20)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(owner)
    resp = await ac.patch(
        f"/shop/orders/{order.id}",
        json={
            "user_id": str(owner.id),
            "items": [{"product_id": str(product.id), "quantity": 3}],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["total_price"] == 30


async def test_update_order_payment_by_unrelated_user_returns_403(
    db_session, authed_client_factory
) -> None:
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    order = await _seed_order(db_session, owner)

    ac = authed_client_factory(stranger)
    resp = await ac.patch(f"/shop/orders/{order.id}/payment", json={"is_paid": True})
    assert resp.status_code == 403


async def test_class_cadre_collection_does_not_confirm_council_payment(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    owner = await _bare_user(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    order = await _seed_order(db_session, owner, class_id=sc.id)

    ac = authed_client_factory(cadre)
    resp = await ac.patch(f"/shop/orders/{order.id}/collection", json={"is_class_collected": True})
    assert resp.status_code == 200
    assert resp.json()["is_class_collected"] is True
    assert resp.json()["is_paid"] is False

    official = await ac.patch(f"/shop/orders/{order.id}/payment", json={"is_paid": True})
    assert official.status_code == 403
    class_payment = await ac.patch(f"/shop/orders/classes/{sc.id}/payment", json={"is_paid": True})
    assert class_payment.status_code == 403


async def test_council_can_confirm_whole_class_without_changing_cadre_notes(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    manager = await _bare_user(db_session)
    await _grant_permission(db_session, manager, "shop:manage_orders")
    first = await _seed_order(db_session, buyer, class_id=sc.id, total_price=100)
    second = await _seed_order(db_session, buyer, class_id=sc.id, total_price=200)
    await shop_svc.set_class_collected(db_session, first, collected=True, actor_id=buyer.id)

    ac = authed_client_factory(manager)
    response = await ac.patch(
        f"/shop/orders/classes/{sc.id}/payment",
        json={"is_paid": True, "activity_id": None},
    )
    assert response.status_code == 200
    assert response.json()["updated_orders"] == 2
    assert first.is_paid is True and second.is_paid is True
    assert first.is_class_collected is True and second.is_class_collected is False


# ── 班級幹部檢視 ──────────────────────────────────────────────────────────────


async def test_list_class_orders_returns_only_cadre_classes(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    other_sc = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session)
    await _seed_order(db_session, buyer, class_id=sc.id)
    await _seed_order(db_session, buyer, class_id=other_sc.id)

    ac = authed_client_factory(cadre)
    resp = await ac.get("/shop/orders/class")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["class_id"] == str(sc.id)


async def test_class_order_summary_for_cadre(db_session, authed_client_factory) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    buyer = await _bare_user(db_session)
    order = await _seed_order(db_session, buyer, class_id=sc.id, total_price=200)
    order.is_class_collected = True

    ac = authed_client_factory(cadre)
    resp = await ac.get("/shop/orders/class/summary")
    assert resp.status_code == 200
    assert resp.json()["order_count"] == 1
    assert resp.json()["paid_amount"] == 200


async def test_create_class_order_by_non_cadre_returns_403(
    db_session, authed_client_factory
) -> None:
    await _make_class(db_session, start="11501", end="11540")
    stranger = await _bare_user(db_session)
    student = await _bare_user(db_session, student_id="11510")
    product = await _make_active_product(db_session, student, price=10)

    ac = authed_client_factory(stranger)
    resp = await ac.post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert resp.status_code == 403


async def test_create_class_order_unknown_student_returns_404(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    product = await _make_active_product(db_session, cadre, price=10)

    ac = authed_client_factory(cadre)
    resp = await ac.post(
        "/shop/orders/class",
        json={
            "user_id": str(uuid.uuid4()),
            "items": [{"product_id": str(product.id), "quantity": 1}],
        },
    )
    assert resp.status_code == 404


async def test_create_class_order_by_cadre_succeeds(db_session, authed_client_factory) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    product = await _make_active_product(db_session, cadre, price=15, stock=10)

    ac = authed_client_factory(cadre)
    resp = await ac.post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [{"product_id": str(product.id), "quantity": 2}],
        },
    )
    assert resp.status_code == 201
    orders = resp.json()
    assert orders[0]["total_price"] == 30
    assert orders[0]["assisted_by_id"] == str(cadre.id)


async def test_cadre_can_register_multiple_products_in_one_request(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    first = await _make_active_product(db_session, cadre, price=15)
    second = await _make_active_product(db_session, cadre, price=25)

    response = await authed_client_factory(cadre).post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [
                {"product_id": str(first.id), "quantity": 2},
                {"product_id": str(second.id), "quantity": 3},
            ],
        },
    )

    assert response.status_code == 201
    orders = response.json()
    assert len(orders) == 1
    assert orders[0]["total_price"] == 105
    assert {item["product_id"]: item["quantity"] for item in orders[0]["items"]} == {
        str(first.id): 2,
        str(second.id): 3,
    }


async def test_cadre_multi_product_request_splits_activities(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    general = await _make_active_product(db_session, cadre, price=15)
    org = Org(name=f"shop-{uuid.uuid4().hex[:6]}")
    activity = Activity(name="活動商品", org=org, status=ActivityStatus.ACTIVE)
    db_session.add_all([org, activity])
    await db_session.flush()
    event_category = await _make_category(db_session, cadre, activity_id=activity.id)
    event_product = await _make_active_product(db_session, cadre, price=25, category=event_category)

    response = await authed_client_factory(cadre).post(
        "/shop/orders/class",
        json={
            "user_id": str(student.id),
            "items": [
                {"product_id": str(general.id), "quantity": 2},
                {"product_id": str(event_product.id), "quantity": 3},
            ],
        },
    )

    assert response.status_code == 201
    orders = response.json()
    assert len(orders) == 2
    assert {order["items"][0]["product_id"]: order["total_price"] for order in orders} == {
        str(general.id): 30,
        str(event_product.id): 75,
    }


async def test_clear_all_order_data_requires_shop_manager(
    member_user, authed_client_factory
) -> None:
    response = await authed_client_factory(member_user).delete("/shop/orders")

    assert response.status_code == 403


async def test_clear_all_order_data_requires_authentication(client) -> None:
    response = await client.delete("/shop/orders")

    assert response.status_code == 401


async def test_clear_all_order_data_removes_orders_and_restores_derived_data(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    school_class = await _make_class(db_session, start="11501", end="11540")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, school_class, user_id=cadre.id)
    student = await _bare_user(db_session, student_id="11520")
    first = await _make_active_product(db_session, cadre, price=15, stock=20)
    second = await _make_active_product(db_session, cadre, price=25, stock=30)
    orders = await shop_svc.create_direct_order(
        db_session,
        user_id=student.id,
        class_id=school_class.id,
        data=ClassOrderUpsert(
            user_id=student.id,
            items=[
                OrderItemCreate(product_id=first.id, quantity=2),
                OrderItemCreate(product_id=second.id, quantity=3),
            ],
        ),
        assisted_by_id=cadre.id,
    )
    db_session.add(
        OutboxEvent(
            event_type="shop.order_confirmed",
            payload={"order_id": str(orders[0].id)},
            created_at=datetime.now(UTC),
        )
    )
    db_session.add(
        Receivable(
            source_type=ReceivableSource.MANUAL.value,
            user_id=student.id,
            title="保留的非商品應收款",
            amount=100,
        )
    )
    await db_session.flush()

    response = await authed_client_factory(member_user).delete("/shop/orders")

    assert response.status_code == 200
    assert response.json() == {"deleted_order_count": 1}
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 0
    assert await db_session.scalar(select(func.count()).select_from(OrderItem)) == 0
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Receivable)
            .where(Receivable.source_type == ReceivableSource.SHOP_ORDER.value)
        )
        == 0
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(Receivable)
            .where(Receivable.source_type == ReceivableSource.MANUAL.value)
        )
        == 1
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(OutboxEvent)
            .where(OutboxEvent.event_type == "shop.order_confirmed")
        )
        == 0
    )
    assert (await db_session.get(Product, first.id)).stock_quantity == 20
    assert (await db_session.get(Product, second.id)).stock_quantity == 30


# ── 後台統計 ──────────────────────────────────────────────────────────────────


async def test_order_summary_requires_permission(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders/summary")
    assert resp.status_code == 403


async def test_order_summary_with_permission_groups_by_class(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:view_all")
    sc = await _make_class(db_session)
    buyer = await _bare_user(db_session)
    await _seed_order(db_session, buyer, class_id=sc.id, total_price=300, is_paid=True)

    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders/summary", params={"group_by": "class"})
    assert resp.status_code == 200
    assert resp.json()["total_amount"] == 300


async def test_order_quantities_requires_permission(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders/quantities")
    assert resp.status_code == 403


async def test_order_quantities_with_permission_returns_rows(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage_orders")
    product = await _make_active_product(db_session, member_user, price=10)
    buyer = await _bare_user(db_session)
    order = await _seed_order(db_session, buyer, total_price=20)
    db_session.add(OrderItem(order_id=order.id, product_id=product.id, quantity=2, unit_price=10))
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/orders/quantities")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["qty_total"] == 2


# ── 報表匯出 ──────────────────────────────────────────────────────────────────


async def test_export_orders_csv_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/reports/orders.csv")
    assert resp.status_code == 403


async def test_export_orders_csv_with_finance_view_permission_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "finance:view")
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/reports/orders.csv")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]


async def test_export_orders_excel_with_finance_view_permission_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "finance:view")
    ac = authed_client_factory(member_user)
    resp = await ac.get("/shop/reports/orders.xlsx")
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers["content-type"]


# ── 結單管理 ──────────────────────────────────────────────────────────────────


async def test_close_category_global_by_manager_then_conflict_on_repeat(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    ac = authed_client_factory(member_user)

    first = await ac.post(f"/shop/categories/{category.id}/close", json={})
    assert first.status_code == 201
    assert first.json()["class_id"] is None

    second = await ac.post(f"/shop/categories/{category.id}/close", json={})
    assert second.status_code == 409


async def test_close_category_by_cadre_for_own_class_succeeds(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    category = await _make_category(db_session, cadre)

    ac = authed_client_factory(cadre)
    resp = await ac.post(f"/shop/categories/{category.id}/close", json={"class_id": str(sc.id)})
    assert resp.status_code == 201
    assert resp.json()["class_id"] == str(sc.id)


async def test_close_category_globally_by_cadre_returns_403(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    category = await _make_category(db_session, cadre)

    ac = authed_client_factory(cadre)
    resp = await ac.post(f"/shop/categories/{category.id}/close", json={})
    assert resp.status_code == 403


async def test_close_category_by_cadre_for_other_class_returns_403(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    other_sc = await _make_class(db_session, start="11601", end="11640")
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    category = await _make_category(db_session, cadre)

    ac = authed_client_factory(cadre)
    resp = await ac.post(
        f"/shop/categories/{category.id}/close", json={"class_id": str(other_sc.id)}
    )
    assert resp.status_code == 403


async def test_reopen_category_when_not_closed_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/shop/categories/{category.id}/close")
    assert resp.status_code == 409


async def test_reopen_category_succeeds_after_close(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    category = await _make_category(db_session, member_user)
    ac = authed_client_factory(member_user)
    await ac.post(f"/shop/categories/{category.id}/close", json={})

    resp = await ac.delete(f"/shop/categories/{category.id}/close")
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


async def test_get_close_status_reflects_closed_and_open_categories(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "shop:manage")
    closed_category = await _make_category(db_session, member_user, name="已結單")
    open_category = await _make_category(db_session, member_user, name="未結單")
    ac = authed_client_factory(member_user)
    await ac.post(f"/shop/categories/{closed_category.id}/close", json={})

    resp = await ac.get(
        "/shop/close-status",
        params={"category_ids": [str(closed_category.id), str(open_category.id)]},
    )
    assert resp.status_code == 200
    statuses = resp.json()["statuses"]
    assert statuses[str(closed_category.id)]["is_closed"] is True
    assert statuses[str(open_category.id)]["is_closed"] is False
