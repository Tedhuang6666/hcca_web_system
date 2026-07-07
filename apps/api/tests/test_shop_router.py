"""商品訂購系統 Router 層測試 - 涵蓋 HTTP 端點的權限與流程分支。

test_shop_class.py 已涵蓋服務層（班級歸戶／變體計價／結單）；本檔補齊 HTTP 層
（router 權限檢查、404/403/409 分支、報表匯出、結單權限矩陣）。
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity, ActivityConvener, ActivityStatus
from api.models.org import Org, Permission, Position, UserPosition
from api.models.shop import Order, OrderItem, OrderStatus, ProductCategory
from api.models.user import User
from api.schemas.school_class import ClassStudentRangeCreate, SchoolClassCreate
from api.schemas.shop import (
    ProductCategoryCreate,
    ProductCreate,
    ProductSeriesCreate,
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
    db: AsyncSession, creator: User, *, price: int = 100, stock: int = 50, category=None
):
    category = category or await _make_category(db, creator)
    series = await shop_svc.create_series(
        db, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    product = await shop_svc.create_product(
        db,
        data=ProductCreate(series_id=series.id, name="商品", price=price, stock_quantity=stock),
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


# ── 購物車 ────────────────────────────────────────────────────────────────────


async def test_cart_add_update_remove_and_clear_flow(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    product = await _make_active_product(db_session, creator, price=50)
    ac = authed_client_factory(member_user)

    empty = await ac.get("/shop/cart")
    assert empty.status_code == 200
    assert empty.json()["items"] == []

    added = await ac.post("/shop/cart/items", json={"product_id": str(product.id), "quantity": 2})
    assert added.status_code == 201
    item_id = added.json()["items"][0]["id"]
    assert added.json()["total_price"] == 100

    updated = await ac.patch(f"/shop/cart/items/{item_id}", json={"quantity": 3})
    assert updated.status_code == 200
    assert updated.json()["total_price"] == 150

    removed = await ac.delete(f"/shop/cart/items/{item_id}")
    assert removed.status_code == 200
    assert removed.json()["items"] == []

    await ac.post("/shop/cart/items", json={"product_id": str(product.id), "quantity": 1})
    cleared = await ac.delete("/shop/cart")
    assert cleared.status_code == 200
    assert cleared.json()["items"] == []


async def test_add_cart_item_unknown_product_returns_422(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/cart/items", json={"product_id": str(uuid.uuid4()), "quantity": 1})
    assert resp.status_code == 422


# ── 結單流程（checkout）─────────────────────────────────────────────────────


async def test_checkout_empty_cart_returns_422(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/shop/cart/checkout", json={})
    assert resp.status_code == 422


async def test_checkout_happy_path_creates_order_and_clears_cart(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    buyer = await _bare_user(db_session, student_id="11510")
    product = await _make_active_product(db_session, buyer, price=80, stock=5)
    ac = authed_client_factory(buyer)

    await ac.post("/shop/cart/items", json={"product_id": str(product.id), "quantity": 2})
    resp = await ac.post("/shop/cart/checkout", json={"notes": "測試訂單"})
    assert resp.status_code == 201
    orders = resp.json()
    assert len(orders) == 1
    assert orders[0]["total_price"] == 160
    assert orders[0]["class_id"] == str(sc.id)

    cart = await ac.get("/shop/cart")
    assert cart.json()["items"] == []


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


async def test_update_order_payment_by_class_cadre_succeeds(
    db_session, authed_client_factory
) -> None:
    sc = await _make_class(db_session)
    owner = await _bare_user(db_session)
    cadre = await _bare_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)
    order = await _seed_order(db_session, owner, class_id=sc.id)

    ac = authed_client_factory(cadre)
    resp = await ac.patch(f"/shop/orders/{order.id}/payment", json={"is_paid": True})
    assert resp.status_code == 200
    assert resp.json()["is_paid"] is True


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
    await _seed_order(db_session, buyer, class_id=sc.id, total_price=200, is_paid=True)

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
