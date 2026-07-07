"""劃位系統路由測試（apps/api/src/api/routers/seating.py）。"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.seating import SeatingZone
from api.models.shop import Order, OrderItem, OrderStatus, ProductCategory
from api.models.user import User
from api.schemas.shop import ProductCategoryCreate, ProductCreate, ProductSeriesCreate
from api.services import shop as shop_svc


async def _make_category(db: AsyncSession, creator: User) -> ProductCategory:
    return await shop_svc.create_category(
        db, data=ProductCategoryCreate(name="票券"), created_by=creator.id
    )


async def _make_active_product(
    db: AsyncSession, creator: User, *, price: int = 100, stock: int = 50
):
    category = await _make_category(db, creator)
    series = await shop_svc.create_series(
        db, data=ProductSeriesCreate(category_id=category.id, name="系列")
    )
    product = await shop_svc.create_product(
        db,
        data=ProductCreate(
            series_id=series.id, name="演唱會票券", price=price, stock_quantity=stock
        ),
        created_by=creator.id,
    )
    return await shop_svc.activate_product(db, product)


async def _make_zone(
    db: AsyncSession, product_id: uuid.UUID, *, hold_minutes: int = 10
) -> SeatingZone:
    zone = SeatingZone(product_id=product_id, name="第一場", hold_minutes=hold_minutes)
    db.add(zone)
    await db.flush()
    return zone


async def _make_paid_order(
    db: AsyncSession, buyer: User, product_id: uuid.UUID, *, quantity: int = 2
) -> Order:
    order = Order(
        serial_number=f"ORD-SEAT-{uuid.uuid4().hex[:8]}",
        user_id=buyer.id,
        status=OrderStatus.CONFIRMED,
        total_price=100 * quantity,
        is_paid=True,
    )
    db.add(order)
    await db.flush()
    db.add(OrderItem(order_id=order.id, product_id=product_id, quantity=quantity, unit_price=100))
    await db.flush()
    return order


# ── 場次 CRUD ─────────────────────────────────────────────────────────────────


async def test_create_zone_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    product = await _make_active_product(db_session, member_user)
    ac = authed_client_factory(member_user)
    response = await ac.post(
        "/seating/zones", json={"product_id": str(product.id), "name": "第一場"}
    )
    assert response.status_code == 403


async def test_create_zone_and_list_for_product(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    product = await _make_active_product(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/seating/zones", json={"product_id": str(product.id), "name": "第一場"}
    )
    assert response.status_code == 201
    zone_id = response.json()["id"]

    list_resp = await ac.get(f"/seating/products/{product.id}/zones")
    assert list_resp.status_code == 200
    ids = {row["id"] for row in list_resp.json()}
    assert zone_id in ids


async def test_get_zone_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get(f"/seating/zones/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_replace_seats_then_get_zone_returns_seats(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    ac = authed_client_factory(admin_user)
    response = await ac.put(
        f"/seating/zones/{zone.id}/seats",
        json={"seats": [{"label": "A1"}, {"label": "A2"}]},
    )
    assert response.status_code == 200
    assert {s["label"] for s in response.json()["seats"]} == {"A1", "A2"}


async def test_update_zone_changes_name(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    ac = authed_client_factory(admin_user)
    response = await ac.patch(f"/seating/zones/{zone.id}", json={"name": "改名場次"})
    assert response.status_code == 200
    assert response.json()["name"] == "改名場次"


async def test_delete_zone_removes_it(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    ac = authed_client_factory(admin_user)
    response = await ac.delete(f"/seating/zones/{zone.id}")
    assert response.status_code == 204
    get_resp = await ac.get(f"/seating/zones/{zone.id}")
    assert get_resp.status_code == 404


# ── 自助選位流程 ──────────────────────────────────────────────────────────────


async def test_self_service_hold_and_select_flow(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    buyer = await make_user(email="seat-buyer@school.edu")
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    order = await _make_paid_order(db_session, buyer, product.id, quantity=1)

    manager_ac = authed_client_factory(admin_user)
    seats_resp = await manager_ac.put(
        f"/seating/zones/{zone.id}/seats", json={"seats": [{"label": "A1"}]}
    )
    seat_id = seats_resp.json()["seats"][0]["id"]

    ac = authed_client_factory(buyer)
    seat_map_resp = await ac.get(
        f"/seating/zones/{zone.id}/map", params={"order_id": str(order.id)}
    )
    assert seat_map_resp.status_code == 200
    map_body = seat_map_resp.json()
    assert map_body["can_select_now"] is True
    assert map_body["remaining_quota"] == 1

    hold_resp = await ac.post(f"/seating/zones/{zone.id}/hold", json={"seat_ids": [seat_id]})
    assert hold_resp.status_code == 200
    assert hold_resp.json()["seat_ids"] == [seat_id]

    select_resp = await ac.post(
        "/seating/select", json={"order_id": str(order.id), "seat_ids": [seat_id]}
    )
    assert select_resp.status_code == 200
    assignments = select_resp.json()
    assert len(assignments) == 1
    assert assignments[0]["seat_id"] == seat_id
    assert assignments[0]["user_id"] == str(buyer.id)


async def test_select_without_hold_fails(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    buyer = await make_user(email="seat-buyer-nohold@school.edu")
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    order = await _make_paid_order(db_session, buyer, product.id, quantity=1)

    manager_ac = authed_client_factory(admin_user)
    seats_resp = await manager_ac.put(
        f"/seating/zones/{zone.id}/seats", json={"seats": [{"label": "B1"}]}
    )
    seat_id = seats_resp.json()["seats"][0]["id"]

    ac = authed_client_factory(buyer)
    select_resp = await ac.post(
        "/seating/select", json={"order_id": str(order.id), "seat_ids": [seat_id]}
    )
    assert select_resp.status_code == 400


async def test_select_exceeding_quota_fails(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    buyer = await make_user(email="seat-buyer-overquota@school.edu")
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    order = await _make_paid_order(db_session, buyer, product.id, quantity=1)

    manager_ac = authed_client_factory(admin_user)
    seats_resp = await manager_ac.put(
        f"/seating/zones/{zone.id}/seats", json={"seats": [{"label": "C1"}, {"label": "C2"}]}
    )
    seat_ids = [s["id"] for s in seats_resp.json()["seats"]]

    ac = authed_client_factory(buyer)
    await ac.post(f"/seating/zones/{zone.id}/hold", json={"seat_ids": seat_ids})
    select_resp = await ac.post(
        "/seating/select", json={"order_id": str(order.id), "seat_ids": seat_ids}
    )
    assert select_resp.status_code == 400


async def test_select_for_others_order_forbidden(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    owner = await make_user(email="seat-order-owner@school.edu")
    intruder = await make_user(email="seat-intruder@school.edu")
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    order = await _make_paid_order(db_session, owner, product.id, quantity=1)

    manager_ac = authed_client_factory(admin_user)
    seats_resp = await manager_ac.put(
        f"/seating/zones/{zone.id}/seats", json={"seats": [{"label": "D1"}]}
    )
    seat_id = seats_resp.json()["seats"][0]["id"]

    ac = authed_client_factory(intruder)
    select_resp = await ac.post(
        "/seating/select", json={"order_id": str(order.id), "seat_ids": [seat_id]}
    )
    assert select_resp.status_code == 403


async def test_admin_assign_seats_for_order(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    buyer = await make_user(email="seat-admin-assign@school.edu")
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    order = await _make_paid_order(db_session, buyer, product.id, quantity=1)

    ac = authed_client_factory(admin_user)
    seats_resp = await ac.put(f"/seating/zones/{zone.id}/seats", json={"seats": [{"label": "E1"}]})
    seat_id = seats_resp.json()["seats"][0]["id"]

    response = await ac.post(
        "/seating/assign", json={"order_id": str(order.id), "seat_ids": [seat_id]}
    )
    assert response.status_code == 200
    assert response.json()[0]["user_id"] == str(buyer.id)


async def test_order_assignments_owner_can_view(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    buyer = await make_user(email="seat-view-owner@school.edu")
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    order = await _make_paid_order(db_session, buyer, product.id, quantity=1)

    admin_ac = authed_client_factory(admin_user)
    seats_resp = await admin_ac.put(
        f"/seating/zones/{zone.id}/seats", json={"seats": [{"label": "F1"}]}
    )
    seat_id = seats_resp.json()["seats"][0]["id"]
    await admin_ac.post("/seating/assign", json={"order_id": str(order.id), "seat_ids": [seat_id]})

    ac = authed_client_factory(buyer)
    response = await ac.get(f"/seating/orders/{order.id}/assignments")
    assert response.status_code == 200
    assert len(response.json()) == 1


async def test_order_assignments_stranger_forbidden(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    buyer = await make_user(email="seat-view-owner2@school.edu")
    stranger = await make_user(email="seat-view-stranger@school.edu")
    product = await _make_active_product(db_session, admin_user)
    order = await _make_paid_order(db_session, buyer, product.id, quantity=1)

    ac = authed_client_factory(stranger)
    response = await ac.get(f"/seating/orders/{order.id}/assignments")
    assert response.status_code == 403


async def test_release_assignment_requires_manage_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    buyer = await make_user(email="seat-release@school.edu")
    product = await _make_active_product(db_session, admin_user)
    zone = await _make_zone(db_session, product.id)
    order = await _make_paid_order(db_session, buyer, product.id, quantity=1)

    admin_ac = authed_client_factory(admin_user)
    seats_resp = await admin_ac.put(
        f"/seating/zones/{zone.id}/seats", json={"seats": [{"label": "G1"}]}
    )
    seat_id = seats_resp.json()["seats"][0]["id"]
    assign_resp = await admin_ac.post(
        "/seating/assign", json={"order_id": str(order.id), "seat_ids": [seat_id]}
    )
    assignment_id = assign_resp.json()[0]["id"]

    member_ac = authed_client_factory(member_user)
    forbidden_resp = await member_ac.delete(f"/seating/assignments/{assignment_id}")
    assert forbidden_resp.status_code == 403

    ok_resp = await admin_ac.delete(f"/seating/assignments/{assignment_id}")
    assert ok_resp.status_code == 204
