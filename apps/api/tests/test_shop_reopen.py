"""重新開放訂購須能讀取另一個請求建立的結單紀錄。"""

import pytest
from sqlalchemy import select

from api.models.audit_log import AuditLog
from api.models.shop import ShopOrderClose
from api.schemas.shop import ProductCategoryCreate
from api.services import shop as shop_svc


async def test_reopen_category_loads_original_closer_in_new_request(
    db_session, admin_user, make_user, authed_client_factory
):
    closer = await make_user(display_name="原結單管理員", is_superuser=True, mfa_enabled=True)
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="重新開放測試"),
        created_by=closer.id,
    )
    category_id, closer_id, reopener_id = category.id, closer.id, admin_user.id
    path = f"/shop/categories/{category_id}/close"
    closed = await authed_client_factory(closer).post(path, json={"notes": "保留結單歷程"})
    assert closed.status_code == 201

    # 正式環境每個請求各自載入 ORM 物件，不能依賴建立結單時的 identity map。
    db_session.expunge_all()
    manager = authed_client_factory(admin_user)
    reopened = await manager.delete(path)

    assert reopened.status_code == 200
    assert reopened.json() == {
        **closed.json(),
        "is_active": False,
        "reopened_at": reopened.json()["reopened_at"],
    }
    assert reopened.json()["closed_by_name"] == "原結單管理員"
    assert reopened.json()["reopened_at"] is not None
    record = await db_session.scalar(
        select(ShopOrderClose).where(ShopOrderClose.category_id == category_id)
    )
    assert record.closed_by_id == closer_id
    assert record.reopened_by_id == reopener_id
    status = await manager.get("/shop/close-status", params={"category_ids": str(category_id)})
    assert status.status_code == 200
    assert status.json()["statuses"][str(category_id)]["is_closed"] is False
    audit = await db_session.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == str(category_id), AuditLog.action == "shop.order_reopen"
        )
    )
    assert audit is not None
    assert audit.actor_id == str(reopener_id)


@pytest.mark.parametrize("authenticated", [False, True])
async def test_reopen_category_rejects_unprivileged_requests(
    db_session, client, admin_user, member_user, authed_client_factory, authenticated
):
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="保留結單權限測試"),
        created_by=admin_user.id,
    )
    path = f"/shop/categories/{category.id}/close"
    closed = await authed_client_factory(admin_user).post(path, json={})
    assert closed.status_code == 201
    requester = authed_client_factory(member_user) if authenticated else client

    response = await requester.delete(path)

    assert response.status_code == (403 if authenticated else 401)
    record = await db_session.scalar(
        select(ShopOrderClose).where(ShopOrderClose.category_id == category.id)
    )
    assert record.is_active is True
    assert record.reopened_at is None
    assert record.reopened_by_id is None
