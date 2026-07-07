"""學餐訂購系統路由測試（apps/api/src/api/routers/meal.py）。

涵蓋商家/申請審核、商品與上架、菜單排程與品項、學生訂單 CRUD、午餐股長代訂、
核銷查詢、商家訂單管理與跨組織 IDOR 防護。平台上架/取餐時段（新流程）與整週批次
建立不在此檔範圍內，因其依賴另一套 availability/pickup_slot 情境設定。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.meal import MealVendor, MenuItem, MenuSchedule
from api.models.user import User
from api.schemas.meal import MealVendorCreate, MenuItemCreate, MenuScheduleCreate
from api.schemas.school_class import ClassStudentRangeCreate, SchoolClassCreate
from api.services import meal as meal_svc
from api.services import school_class as class_svc

FUTURE_DEADLINE = datetime.now(UTC) + timedelta(days=7)


async def _make_vendor(db: AsyncSession, creator: User, **overrides) -> MealVendor:
    defaults = dict(name=f"商家-{uuid.uuid4().hex[:6]}")
    defaults.update(overrides)
    return await meal_svc.create_vendor(
        db, data=MealVendorCreate(**defaults), created_by=creator.id
    )


async def _make_schedule(
    db: AsyncSession, vendor: MealVendor, creator: User, *, deadline: datetime = FUTURE_DEADLINE
) -> MenuSchedule:
    return await meal_svc.create_schedule(
        db,
        data=MenuScheduleCreate(vendor_id=vendor.id, date=deadline.date(), order_deadline=deadline),
        created_by=creator.id,
    )


async def _make_menu_item(db: AsyncSession, schedule: MenuSchedule, *, price: int = 60) -> MenuItem:
    return await meal_svc.add_menu_item(
        db, schedule, data=MenuItemCreate(name="排骨便當", price=price)
    )


async def _make_class(db: AsyncSession, creator: User, *, start: str, end: str):
    return await class_svc.create_class(
        db,
        data=SchoolClassCreate(
            academic_year=115,
            class_code=f"c{uuid.uuid4().hex[:4]}",
            grade=1,
            ranges=[ClassStudentRangeCreate(student_id_start=start, student_id_end=end)],
        ),
        created_by=creator.id,
    )


# ── 商家 ─────────────────────────────────────────────────────────────────────


async def test_create_vendor_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.post("/meal/vendors", json={"name": "測試商家"})
    assert response.status_code == 403


async def test_create_vendor_and_get_detail(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post("/meal/vendors", json={"name": "便當店"})
    assert response.status_code == 201
    vendor_id = response.json()["id"]

    detail = await ac.get(f"/meal/vendors/{vendor_id}")
    assert detail.status_code == 200
    assert detail.json()["name"] == "便當店"


async def test_update_vendor_changes_name(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.patch(f"/meal/vendors/{vendor.id}", json={"name": "改名商家"})
    assert response.status_code == 200
    assert response.json()["name"] == "改名商家"


async def test_vendor_application_flow_approve_creates_vendor(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, member_user: User
) -> None:
    applicant_ac = authed_client_factory(member_user)
    apply_resp = await applicant_ac.post("/meal/vendor-applications", json={"name": "新商家申請"})
    assert apply_resp.status_code == 201
    application_id = apply_resp.json()["id"]
    assert apply_resp.json()["status"] == "pending_review"

    ac = authed_client_factory(admin_user)
    list_resp = await ac.get("/meal/vendor-applications")
    assert list_resp.status_code == 200
    assert any(row["id"] == application_id for row in list_resp.json())

    review_resp = await ac.post(
        f"/meal/vendor-applications/{application_id}/review",
        json={"approved": True, "review_note": "沒問題"},
    )
    assert review_resp.status_code == 200
    body = review_resp.json()
    assert body["status"] == "approved"
    assert body["vendor_id"] is not None

    reject_again_resp = await ac.post(
        f"/meal/vendor-applications/{application_id}/review", json={"approved": False}
    )
    assert reject_again_resp.status_code == 409


async def test_vendor_application_requires_permission_to_list(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/meal/vendor-applications")
    assert response.status_code == 403


async def test_assign_and_remove_vendor_manager(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    manager_user = await make_user(email="meal-manager@school.edu")
    ac = authed_client_factory(admin_user)
    assign_resp = await ac.post(
        f"/meal/vendors/{vendor.id}/managers", json={"email": manager_user.email}
    )
    assert assign_resp.status_code == 201

    list_resp = await ac.get(f"/meal/vendors/{vendor.id}/managers")
    assert list_resp.status_code == 200
    assert any(row["user_id"] == str(manager_user.id) for row in list_resp.json())

    remove_resp = await ac.delete(f"/meal/vendors/{vendor.id}/managers/{manager_user.id}")
    assert remove_resp.status_code == 204


async def test_assign_vendor_manager_unknown_email_returns_400(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        f"/meal/vendors/{vendor.id}/managers", json={"email": "nobody@nowhere.edu"}
    )
    assert response.status_code == 400


async def test_vendor_manager_without_meal_manage_can_create_product(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    manager_user = await make_user(email="delegated-manager@school.edu")
    admin_ac = authed_client_factory(admin_user)
    await admin_ac.post(f"/meal/vendors/{vendor.id}/managers", json={"email": manager_user.email})

    ac = authed_client_factory(manager_user)
    response = await ac.post(
        "/meal/products",
        json={"vendor_id": str(vendor.id), "name": "紅茶", "price": 20},
    )
    assert response.status_code == 201


async def test_create_product_stranger_forbidden(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    ac = authed_client_factory(member_user)
    response = await ac.post(
        "/meal/products", json={"vendor_id": str(vendor.id), "name": "紅茶", "price": 20}
    )
    assert response.status_code == 403


async def test_update_product_requires_vendor_manager(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    admin_ac = authed_client_factory(admin_user)
    create_resp = await admin_ac.post(
        "/meal/products", json={"vendor_id": str(vendor.id), "name": "奶茶", "price": 30}
    )
    product_id = create_resp.json()["id"]

    ac = authed_client_factory(member_user)
    response = await ac.patch(f"/meal/products/{product_id}", json={"price": 35})
    assert response.status_code == 403


async def test_list_products_filters_by_vendor(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    await ac.post("/meal/products", json={"vendor_id": str(vendor.id), "name": "紅茶", "price": 20})
    response = await ac.get("/meal/products", params={"vendor_id": str(vendor.id)})
    assert response.status_code == 200
    assert len(response.json()) == 1


# ── 菜單排程與品項 ─────────────────────────────────────────────────────────────


async def test_create_schedule_and_list(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/meal/schedules",
        json={
            "vendor_id": str(vendor.id),
            "date": FUTURE_DEADLINE.date().isoformat(),
            "order_deadline": FUTURE_DEADLINE.isoformat(),
        },
    )
    assert response.status_code == 201
    schedule_id = response.json()["id"]

    list_resp = await ac.get("/meal/schedules", params={"vendor_id": str(vendor.id)})
    assert list_resp.status_code == 200
    ids = {row["id"] for row in list_resp.json()}
    assert schedule_id in ids


async def test_create_schedule_duplicate_date_conflicts(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    payload = {
        "vendor_id": str(vendor.id),
        "date": FUTURE_DEADLINE.date().isoformat(),
        "order_deadline": FUTURE_DEADLINE.isoformat(),
    }
    first = await ac.post("/meal/schedules", json=payload)
    assert first.status_code == 201
    second = await ac.post("/meal/schedules", json=payload)
    assert second.status_code == 409


async def test_close_schedule_then_get_shows_closed(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    ac = authed_client_factory(admin_user)
    close_resp = await ac.post(f"/meal/schedules/{schedule.id}/close")
    assert close_resp.status_code == 200
    assert close_resp.json()["is_closed"] is True


async def test_add_update_delete_menu_item(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    ac = authed_client_factory(admin_user)
    add_resp = await ac.post(
        f"/meal/schedules/{schedule.id}/items", json={"name": "雞腿飯", "price": 70}
    )
    assert add_resp.status_code == 201
    item_id = add_resp.json()["id"]

    update_resp = await ac.patch(f"/meal/items/{item_id}", json={"price": 75})
    assert update_resp.status_code == 200
    assert update_resp.json()["price"] == 75

    delete_resp = await ac.delete(f"/meal/items/{item_id}")
    assert delete_resp.status_code == 204


async def test_delete_menu_item_with_order_conflicts(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    buyer = await make_user(email="meal-buyer-blocking-delete@school.edu")
    buyer_ac = authed_client_factory(buyer)
    await buyer_ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )

    ac = authed_client_factory(admin_user)
    response = await ac.delete(f"/meal/items/{item.id}")
    assert response.status_code == 409


# ── 學生訂單 ──────────────────────────────────────────────────────────────────


async def test_create_order_happy_path(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule, price=65)
    buyer = await make_user(email="meal-buyer-happy@school.edu")
    ac = authed_client_factory(buyer)
    response = await ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 2}],
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["total_price"] == 130
    assert body["user_id"] == str(buyer.id)


async def test_create_order_duplicate_conflicts(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    buyer = await make_user(email="meal-buyer-dup@school.edu")
    ac = authed_client_factory(buyer)
    payload = {
        "schedule_id": str(schedule.id),
        "items": [{"menu_item_id": str(item.id), "quantity": 1}],
    }
    first = await ac.post("/meal/orders", json=payload)
    assert first.status_code == 201
    second = await ac.post("/meal/orders", json=payload)
    assert second.status_code == 409


async def test_create_order_on_closed_schedule_returns_422(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    await meal_svc.close_schedule(db_session, schedule)
    buyer = await make_user(email="meal-buyer-closed@school.edu")
    ac = authed_client_factory(buyer)
    response = await ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )
    assert response.status_code == 422


async def test_get_order_stranger_forbidden(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    buyer = await make_user(email="meal-buyer-owner@school.edu")
    stranger = await make_user(email="meal-buyer-stranger@school.edu")
    buyer_ac = authed_client_factory(buyer)
    create_resp = await buyer_ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )
    order_id = create_resp.json()["id"]

    ac = authed_client_factory(stranger)
    response = await ac.get(f"/meal/orders/{order_id}")
    assert response.status_code == 403


async def test_list_orders_defaults_to_own(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    owner = await make_user(email="meal-list-owner@school.edu")
    other = await make_user(email="meal-list-other@school.edu")
    for user in (owner, other):
        ac = authed_client_factory(user)
        await ac.post(
            "/meal/orders",
            json={
                "schedule_id": str(schedule.id),
                "items": [{"menu_item_id": str(item.id), "quantity": 1}],
            },
        )

    ac = authed_client_factory(owner)
    response = await ac.get("/meal/orders")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["user_id"] == str(owner.id)


async def test_list_orders_manage_query_requires_scope(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get("/meal/orders", params={"my_only": False})
    # admin_user 是 superuser，不受限；改用非 superuser 才會觸發 400。
    assert response.status_code == 200


async def test_cancel_order_by_owner(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    buyer = await make_user(email="meal-cancel-owner@school.edu")
    ac = authed_client_factory(buyer)
    create_resp = await ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )
    order_id = create_resp.json()["id"]

    response = await ac.post(f"/meal/orders/{order_id}/cancel", json={"reason": "不想吃了"})
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


async def test_cancel_order_by_stranger_forbidden(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    buyer = await make_user(email="meal-cancel-owner2@school.edu")
    stranger = await make_user(email="meal-cancel-stranger@school.edu")
    buyer_ac = authed_client_factory(buyer)
    create_resp = await buyer_ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )
    order_id = create_resp.json()["id"]

    ac = authed_client_factory(stranger)
    response = await ac.post(f"/meal/orders/{order_id}/cancel", json={})
    assert response.status_code == 403


async def test_update_order_replaces_items(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule, price=50)
    buyer = await make_user(email="meal-update-owner@school.edu")
    ac = authed_client_factory(buyer)
    create_resp = await ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )
    order_id = create_resp.json()["id"]

    response = await ac.patch(
        f"/meal/orders/{order_id}",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 3}],
        },
    )
    assert response.status_code == 200
    assert response.json()["total_price"] == 150


# ── 商家訂單管理與 IDOR ────────────────────────────────────────────────────────


async def test_confirm_and_complete_order(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    buyer = await make_user(email="meal-confirm-buyer@school.edu")
    buyer_ac = authed_client_factory(buyer)
    create_resp = await buyer_ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )
    order_id = create_resp.json()["id"]

    ac = authed_client_factory(admin_user)
    confirm_resp = await ac.post(f"/meal/orders/{order_id}/confirm")
    assert confirm_resp.status_code == 200
    assert confirm_resp.json()["status"] == "confirmed"

    complete_resp = await ac.post(f"/meal/orders/{order_id}/complete")
    assert complete_resp.status_code == 200
    assert complete_resp.json()["status"] == "completed"


async def test_confirm_order_cross_org_forbidden(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    from api.core.cache import cache_invalidate_user_permissions
    from api.core.clock import local_today
    from api.core.permission_codes import PermissionCode
    from api.models.org import Org, Permission, Position, UserPosition

    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    buyer = await make_user(email="meal-crossorg-buyer@school.edu")
    buyer_ac = authed_client_factory(buyer)
    create_resp = await buyer_ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )
    order_id = create_resp.json()["id"]

    other_manager = await make_user(email="meal-other-org-manager@school.edu")
    other_org = Org(name=f"other-org-{uuid.uuid4().hex[:6]}")
    db_session.add(other_org)
    await db_session.flush()
    position = Position(org_id=other_org.id, name="其他學餐管理")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=PermissionCode.MEAL_MANAGE))
    db_session.add(
        UserPosition(user_id=other_manager.id, position_id=position.id, start_date=local_today())
    )
    await db_session.flush()
    await cache_invalidate_user_permissions(str(other_manager.id))

    ac = authed_client_factory(other_manager)
    response = await ac.post(f"/meal/orders/{order_id}/confirm")
    assert response.status_code == 403


async def test_lookup_order_by_pickup_code(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    buyer = await make_user(email="meal-lookup-buyer@school.edu")
    buyer_ac = authed_client_factory(buyer)
    create_resp = await buyer_ac.post(
        "/meal/orders",
        json={
            "schedule_id": str(schedule.id),
            "items": [{"menu_item_id": str(item.id), "quantity": 1}],
        },
    )
    pickup_code = create_resp.json()["pickup_code"]

    ac = authed_client_factory(admin_user)
    response = await ac.get("/meal/orders/lookup", params={"code": pickup_code})
    assert response.status_code == 200
    assert response.json()["pickup_code"] == pickup_code


async def test_lookup_order_unknown_code_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get("/meal/orders/lookup", params={"code": "ZZZZ-NOPE"})
    assert response.status_code == 404


# ── 午餐股長代訂 ──────────────────────────────────────────────────────────────


async def test_class_order_flow_requires_cadre(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    await _make_class(db_session, admin_user, start="70001", end="70040")
    student = await make_user(email="class-order-student@school.edu", student_id="70005")
    non_cadre = await make_user(email="not-a-cadre@school.edu")

    ac = authed_client_factory(non_cadre)
    response = await ac.post(
        "/meal/orders/class",
        json={
            "user_id": str(student.id),
            "order": {
                "schedule_id": str(schedule.id),
                "items": [{"menu_item_id": str(item.id), "quantity": 1}],
            },
        },
    )
    assert response.status_code == 403


async def test_class_order_flow_happy_path(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    schedule = await _make_schedule(db_session, vendor, admin_user)
    item = await _make_menu_item(db_session, schedule)
    sc = await _make_class(db_session, admin_user, start="80001", end="80040")
    cadre = await make_user(email="lunch-cadre@school.edu", student_id="80001")
    student = await make_user(email="class-order-student2@school.edu", student_id="80005")
    await class_svc.add_cadre(db_session, sc, user_id=cadre.id)

    ac = authed_client_factory(cadre)
    create_resp = await ac.post(
        "/meal/orders/class",
        json={
            "user_id": str(student.id),
            "order": {
                "schedule_id": str(schedule.id),
                "items": [{"menu_item_id": str(item.id), "quantity": 1}],
            },
        },
    )
    assert create_resp.status_code == 201
    order_id = create_resp.json()["id"]
    assert create_resp.json()["assistance_scope"] == "class_assisted"

    list_resp = await ac.get("/meal/orders/class", params={"vendor_id": str(vendor.id)})
    assert list_resp.status_code == 200
    assert any(row["id"] == order_id for row in list_resp.json())

    payment_resp = await ac.post(f"/meal/orders/{order_id}/payment", params={"is_paid": True})
    assert payment_resp.status_code == 200
    assert payment_resp.json()["is_paid"] is True


# ── 報表匯出 ──────────────────────────────────────────────────────────────────


async def test_export_orders_requires_scope_for_non_superuser(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    from api.core.cache import cache_invalidate_user_permissions
    from api.core.clock import local_today
    from api.core.permission_codes import PermissionCode
    from api.models.org import Org, Permission, Position, UserPosition

    manager = await make_user(email="meal-export-manager@school.edu")
    org = Org(name=f"export-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="學餐報表管理")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=PermissionCode.MEAL_MANAGE))
    db_session.add(
        UserPosition(user_id=manager.id, position_id=position.id, start_date=local_today())
    )
    await db_session.flush()
    await cache_invalidate_user_permissions(str(manager.id))

    ac = authed_client_factory(manager)
    response = await ac.get("/meal/reports/orders.csv")
    assert response.status_code == 400


async def test_export_orders_csv_with_vendor_scope(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await _make_vendor(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.get("/meal/reports/orders.csv", params={"vendor_id": str(vendor.id)})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
