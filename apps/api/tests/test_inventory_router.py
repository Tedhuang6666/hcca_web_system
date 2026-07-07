"""物資管理系統路由測試（apps/api/src/api/routers/inventory.py）。"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cache_invalidate_user_permissions
from api.core.permission_codes import PermissionCode
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User


async def _make_org(db: AsyncSession) -> Org:
    org = Org(name=f"inventory-org-{uuid.uuid4().hex[:6]}")
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


# ── 類別 ─────────────────────────────────────────────────────────────────────


async def test_list_categories_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/inventory/categories")
    assert response.status_code == 403


async def test_create_category_requires_manage(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    await _grant(db_session, member_user, PermissionCode.INVENTORY_VIEW)
    ac = authed_client_factory(member_user)
    org = await _make_org(db_session)
    response = await ac.post("/inventory/categories", json={"name": "文具", "org_id": str(org.id)})
    assert response.status_code == 403


async def test_create_update_delete_category(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/inventory/categories", json={"name": "文具", "org_id": str(org.id)}
    )
    assert create_resp.status_code == 201
    cat_id = create_resp.json()["id"]

    update_resp = await ac.patch(f"/inventory/categories/{cat_id}", json={"name": "辦公文具"})
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "辦公文具"

    list_resp = await ac.get("/inventory/categories")
    assert list_resp.status_code == 200
    assert any(row["id"] == cat_id for row in list_resp.json())

    delete_resp = await ac.delete(f"/inventory/categories/{cat_id}")
    assert delete_resp.status_code == 204

    list_after_resp = await ac.get("/inventory/categories")
    assert all(row["id"] != cat_id for row in list_after_resp.json())


async def test_update_category_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.patch(f"/inventory/categories/{uuid.uuid4()}", json={"name": "x"})
    assert response.status_code == 404


# ── 品項 ─────────────────────────────────────────────────────────────────────


async def test_create_item_with_initial_quantity_records_transaction(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/inventory/items",
        json={"name": "A4紙", "quantity": 50, "low_stock_threshold": 10, "org_id": str(org.id)},
    )
    assert response.status_code == 201
    item_id = response.json()["id"]
    assert response.json()["quantity"] == 50

    txns_resp = await ac.get(f"/inventory/items/{item_id}/transactions")
    assert txns_resp.status_code == 200
    assert len(txns_resp.json()) == 1
    assert txns_resp.json()[0]["txn_type"] == "initial"


async def test_get_item_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/inventory/items/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_update_item_changes_name(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post("/inventory/items", json={"name": "舊品名", "org_id": str(org.id)})
    item_id = create_resp.json()["id"]

    response = await ac.patch(f"/inventory/items/{item_id}", json={"name": "新品名"})
    assert response.status_code == 200
    assert response.json()["name"] == "新品名"


async def test_list_items_filters_low_stock(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    await ac.post(
        "/inventory/items",
        json={"name": "低庫存品", "quantity": 2, "low_stock_threshold": 5, "org_id": str(org.id)},
    )
    await ac.post(
        "/inventory/items",
        json={"name": "充足品", "quantity": 50, "low_stock_threshold": 5, "org_id": str(org.id)},
    )

    response = await ac.get("/inventory/items", params={"low_stock_only": True})
    assert response.status_code == 200
    names = {row["name"] for row in response.json()}
    assert "低庫存品" in names
    assert "充足品" not in names


async def test_adjust_stock_out_reduces_quantity(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/inventory/items", json={"name": "耗材", "quantity": 20, "org_id": str(org.id)}
    )
    item_id = create_resp.json()["id"]

    response = await ac.post(
        f"/inventory/items/{item_id}/adjust",
        json={"txn_type": "out", "quantity": 5, "notes": "領用"},
    )
    assert response.status_code == 201
    assert response.json()["quantity_after"] == 15

    detail_resp = await ac.get(f"/inventory/items/{item_id}")
    assert detail_resp.json()["quantity"] == 15


async def test_adjust_stock_out_insufficient_returns_400(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/inventory/items", json={"name": "稀缺品", "quantity": 3, "org_id": str(org.id)}
    )
    item_id = create_resp.json()["id"]

    response = await ac.post(
        f"/inventory/items/{item_id}/adjust", json={"txn_type": "out", "quantity": 10}
    )
    assert response.status_code == 400


async def test_adjust_stock_requires_stock_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    create_resp = await admin_ac.post(
        "/inventory/items", json={"name": "品項", "quantity": 10, "org_id": str(org.id)}
    )
    item_id = create_resp.json()["id"]

    await _grant(db_session, member_user, PermissionCode.INVENTORY_VIEW)
    ac = authed_client_factory(member_user)
    response = await ac.post(
        f"/inventory/items/{item_id}/adjust", json={"txn_type": "in", "quantity": 5}
    )
    assert response.status_code == 403


async def test_list_transactions_across_items(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    await ac.post("/inventory/items", json={"name": "品項A", "quantity": 5, "org_id": str(org.id)})
    await ac.post("/inventory/items", json={"name": "品項B", "quantity": 8, "org_id": str(org.id)})

    response = await ac.get("/inventory/transactions")
    assert response.status_code == 200
    assert len(response.json()) >= 2


# ── 採購申請 ──────────────────────────────────────────────────────────────────


async def test_procurement_full_lifecycle(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    item_resp = await ac.post("/inventory/items", json={"name": "採購品項", "org_id": str(org.id)})
    item_id = item_resp.json()["id"]

    create_resp = await ac.post(
        "/inventory/procurements",
        json={
            "title": "文具採購",
            "org_id": str(org.id),
            "line_items": [
                {
                    "item_id": item_id,
                    "item_name": "採購品項",
                    "quantity_requested": 100,
                }
            ],
        },
    )
    assert create_resp.status_code == 201
    proc_id = create_resp.json()["id"]
    assert create_resp.json()["status"] == "draft"

    submit_resp = await ac.post(f"/inventory/procurements/{proc_id}/submit")
    assert submit_resp.status_code == 200
    assert submit_resp.json()["status"] == "submitted"

    approve_resp = await ac.post(f"/inventory/procurements/{proc_id}/approve")
    assert approve_resp.status_code == 200
    assert approve_resp.json()["status"] == "approved"

    line_item_id = approve_resp.json()["line_items"][0]["id"]
    receive_resp = await ac.post(
        f"/inventory/procurements/{proc_id}/receive",
        json={"received_quantities": {line_item_id: 100}},
    )
    assert receive_resp.status_code == 200
    assert receive_resp.json()["status"] == "received"

    item_after = await ac.get(f"/inventory/items/{item_id}")
    assert item_after.json()["quantity"] == 100


async def test_submit_procurement_without_line_items_returns_400(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/inventory/procurements", json={"title": "空清單", "org_id": str(org.id)}
    )
    proc_id = create_resp.json()["id"]

    response = await ac.post(f"/inventory/procurements/{proc_id}/submit")
    assert response.status_code == 400


async def test_reject_procurement_requires_manage_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    create_resp = await admin_ac.post(
        "/inventory/procurements",
        json={
            "title": "待駁回",
            "org_id": str(org.id),
            "line_items": [{"item_name": "x", "quantity_requested": 1}],
        },
    )
    proc_id = create_resp.json()["id"]
    await admin_ac.post(f"/inventory/procurements/{proc_id}/submit")

    await _grant(db_session, member_user, PermissionCode.INVENTORY_STOCK)
    ac = authed_client_factory(member_user)
    response = await ac.post(f"/inventory/procurements/{proc_id}/reject")
    assert response.status_code == 403


async def test_update_procurement_after_submit_returns_400(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/inventory/procurements",
        json={
            "title": "測試",
            "org_id": str(org.id),
            "line_items": [{"item_name": "x", "quantity_requested": 1}],
        },
    )
    proc_id = create_resp.json()["id"]
    await ac.post(f"/inventory/procurements/{proc_id}/submit")

    response = await ac.patch(f"/inventory/procurements/{proc_id}", json={"title": "改標題"})
    assert response.status_code == 400


async def test_list_procurements_own_only_filter(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    other = await make_user(email="inventory-other-requester@school.edu")
    await _grant(db_session, other, PermissionCode.INVENTORY_STOCK)

    admin_ac = authed_client_factory(admin_user)
    await admin_ac.post(
        "/inventory/procurements",
        json={
            "title": "管理員的申請",
            "org_id": str(org.id),
            "line_items": [{"item_name": "x", "quantity_requested": 1}],
        },
    )

    ac = authed_client_factory(other)
    await ac.post(
        "/inventory/procurements",
        json={
            "title": "其他人的申請",
            "org_id": str(org.id),
            "line_items": [{"item_name": "y", "quantity_requested": 1}],
        },
    )

    response = await ac.get("/inventory/procurements", params={"own_only": True})
    assert response.status_code == 200
    titles = {row["title"] for row in response.json()}
    assert titles == {"其他人的申請"}


# ── 儀表板 ────────────────────────────────────────────────────────────────────


async def test_dashboard_counts(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    await ac.post(
        "/inventory/items",
        json={"name": "儀表板品項", "quantity": 1, "low_stock_threshold": 5, "org_id": str(org.id)},
    )

    response = await ac.get("/inventory/dashboard")
    assert response.status_code == 200
    body = response.json()
    assert body["total_items"] >= 1
    assert body["low_stock_count"] >= 1
