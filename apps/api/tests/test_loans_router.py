"""物品借用系統路由測試（apps/api/src/api/routers/loans.py）。"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cache_invalidate_user_permissions
from api.core.clock import now_local
from api.core.permission_codes import PermissionCode
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User


async def _make_org(db: AsyncSession) -> Org:
    org = Org(name=f"loan-org-{uuid.uuid4().hex[:6]}")
    db.add(org)
    await db.flush()
    return org


async def _grant(db: AsyncSession, user: User, code: str) -> None:
    org = Org(name=f"perm-org-{uuid.uuid4().hex[:6]}")
    db.add(org)
    await db.flush()
    position = Position(org_id=org.id, name="測試職位")
    db.add(position)
    await db.flush()
    db.add(Permission(position_id=position.id, code=code))
    db.add(UserPosition(user_id=user.id, position_id=position.id, start_date=date.today()))
    await db.flush()
    await cache_invalidate_user_permissions(str(user.id))


async def _make_item_with_unit(
    ac: AsyncClient, org_id: uuid.UUID, *, unit_code: str = "A1"
) -> tuple[str, str]:
    item_resp = await ac.post("/loans/items", json={"name": "帳篷", "org_id": str(org_id)})
    item_id = item_resp.json()["id"]
    unit_resp = await ac.post(f"/loans/items/{item_id}/units", json={"unit_codes": [unit_code]})
    unit_id = unit_resp.json()[0]["id"]
    return item_id, unit_id


# ── 物品類型與個體 ────────────────────────────────────────────────────────────


async def test_list_items_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/loans/items")
    assert response.status_code == 403


async def test_create_item_requires_manage(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    await _grant(db_session, member_user, PermissionCode.LOAN_CHECKOUT)
    org = await _make_org(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.post("/loans/items", json={"name": "帳篷", "org_id": str(org.id)})
    assert response.status_code == 403


async def test_create_and_update_item(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post("/loans/items", json={"name": "帳篷", "org_id": str(org.id)})
    assert create_resp.status_code == 201
    item_id = create_resp.json()["id"]
    assert create_resp.json()["total_count"] == 0

    update_resp = await ac.patch(f"/loans/items/{item_id}", json={"name": "露營帳篷"})
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "露營帳篷"

    delete_resp = await ac.delete(f"/loans/items/{item_id}")
    assert delete_resp.status_code == 204

    list_resp = await ac.get("/loans/items")
    assert all(row["id"] != item_id for row in list_resp.json())


async def test_add_units_and_list(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    item_id, unit_id = await _make_item_with_unit(ac, org.id, unit_code="TENT-01")

    list_resp = await ac.get(f"/loans/items/{item_id}/units")
    assert list_resp.status_code == 200
    assert any(row["id"] == unit_id for row in list_resp.json())

    item_resp = await ac.get("/loans/items")
    item = next(row for row in item_resp.json() if row["id"] == item_id)
    assert item["total_count"] == 1
    assert item["available_count"] == 1


async def test_add_units_duplicate_code_conflicts(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    item_id, _ = await _make_item_with_unit(ac, org.id, unit_code="TENT-DUP")

    response = await ac.post(f"/loans/items/{item_id}/units", json={"unit_codes": ["TENT-DUP"]})
    assert response.status_code == 409


async def test_add_units_empty_list_rejected(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    item_resp = await ac.post("/loans/items", json={"name": "帳篷", "org_id": str(org.id)})
    item_id = item_resp.json()["id"]

    response = await ac.post(f"/loans/items/{item_id}/units", json={"unit_codes": []})
    assert response.status_code == 422


async def test_update_unit_cannot_force_available_while_borrowed(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    _, unit_id = await _make_item_with_unit(ac, org.id, unit_code="LOCK-01")
    await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "王小明",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )

    response = await ac.patch(f"/loans/units/{unit_id}", json={"status": "available"})
    assert response.status_code == 400


# ── 借還操作 ──────────────────────────────────────────────────────────────────


async def test_available_items_reflects_units(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    await _make_item_with_unit(ac, org.id, unit_code="AV-01")

    response = await ac.get("/loans/items/available")
    assert response.status_code == 200
    assert any(row["available_count"] >= 1 for row in response.json())


async def test_checkout_happy_path(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    _, unit_id = await _make_item_with_unit(ac, org.id, unit_code="CHK-01")

    response = await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "王小明",
            "borrower_student_id": "11301",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["unit_code"] == "CHK-01"
    assert body["status"] == "active"
    assert body["borrower_name"] == "王小明"


async def test_checkout_unavailable_unit_conflicts(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    _, unit_id = await _make_item_with_unit(ac, org.id, unit_code="CHK-02")
    await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "第一位借用人",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )

    response = await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "第二位借用人",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )
    assert response.status_code == 409


async def test_checkout_requires_checkout_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    _, unit_id = await _make_item_with_unit(admin_ac, org.id, unit_code="CHK-03")

    ac = authed_client_factory(member_user)
    response = await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "無權限借用人",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )
    assert response.status_code == 403


async def test_return_item_then_unit_available_again(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    item_id, unit_id = await _make_item_with_unit(ac, org.id, unit_code="RET-01")
    checkout_resp = await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "王小明",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )
    record_id = checkout_resp.json()["id"]

    return_resp = await ac.post(f"/loans/records/{record_id}/return")
    assert return_resp.status_code == 200
    assert return_resp.json()["status"] == "returned"
    assert return_resp.json()["returned_at"] is not None

    units_resp = await ac.get(f"/loans/items/{item_id}/units")
    unit = next(row for row in units_resp.json() if row["id"] == unit_id)
    assert unit["status"] == "available"


async def test_return_already_returned_conflicts(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    _, unit_id = await _make_item_with_unit(ac, org.id, unit_code="RET-02")
    checkout_resp = await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "王小明",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )
    record_id = checkout_resp.json()["id"]
    await ac.post(f"/loans/records/{record_id}/return")

    response = await ac.post(f"/loans/records/{record_id}/return")
    assert response.status_code == 400


async def test_return_item_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post(f"/loans/records/{uuid.uuid4()}/return")
    assert response.status_code == 404


async def test_list_records_filters_by_status(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    _, unit_id = await _make_item_with_unit(ac, org.id, unit_code="LIST-01")
    checkout_resp = await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "王小明",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )
    record_id = checkout_resp.json()["id"]

    active_resp = await ac.get("/loans/records", params={"status": "active"})
    assert active_resp.status_code == 200
    assert any(row["id"] == record_id for row in active_resp.json())

    await ac.post(f"/loans/records/{record_id}/return")
    returned_resp = await ac.get("/loans/records", params={"status": "returned"})
    assert any(row["id"] == record_id for row in returned_resp.json())
    active_after_resp = await ac.get("/loans/records", params={"status": "active"})
    assert all(row["id"] != record_id for row in active_after_resp.json())


async def test_update_record_changes_due_date(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    _, unit_id = await _make_item_with_unit(ac, org.id, unit_code="UPD-01")
    checkout_resp = await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "王小明",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )
    record_id = checkout_resp.json()["id"]
    new_due = (now_local() + timedelta(days=10)).isoformat()

    response = await ac.patch(
        f"/loans/records/{record_id}", json={"due_at": new_due, "notes": "展延"}
    )
    assert response.status_code == 200
    assert response.json()["notes"] == "展延"


# ── 儀表板 ────────────────────────────────────────────────────────────────────


async def test_dashboard_counts(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    _, unit_id = await _make_item_with_unit(ac, org.id, unit_code="DASH-01")
    await ac.post(
        "/loans/checkout",
        json={
            "unit_id": unit_id,
            "borrower_name": "王小明",
            "due_at": (now_local() + timedelta(days=3)).isoformat(),
        },
    )

    response = await ac.get("/loans/dashboard")
    assert response.status_code == 200
    body = response.json()
    assert body["active_count"] >= 1
    assert body["total_items"] >= 1
