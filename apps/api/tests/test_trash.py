"""誤刪救援（/admin/trash）路由測試。

trash router 是 MVP：只列示 audit_log 裡疑似刪除的事件，不做還原；
測試重點是權限（system:trash_view）、天數/entity_type 篩選、404。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog
from api.models.user import User


async def _make_audit_log(
    db_session: AsyncSession,
    *,
    action: str = "delete",
    entity_type: str = "document",
    created_at: datetime | None = None,
    actor_email: str | None = "actor@school.edu",
) -> AuditLog:
    row = AuditLog(
        id=uuid.uuid4(),
        entity_type=entity_type,
        entity_id=str(uuid.uuid4()),
        action=action,
        actor_id=str(uuid.uuid4()),
        actor_email=actor_email,
        meta={"reason": "test"},
        created_at=created_at or datetime.now(UTC),
        summary="測試刪除事件",
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def test_list_deletions_without_login_returns_401(client: AsyncClient) -> None:
    """匿名使用者不可查看刪除事件列表。"""
    response = await client.get("/admin/trash")
    assert response.status_code == 401


async def test_list_deletions_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    """一般使用者沒有 system:trash_view 權限，應被拒絕。"""
    ac = authed_client_factory(member_user)
    response = await ac.get("/admin/trash")
    assert response.status_code == 403


async def test_list_deletions_returns_recent_delete_events(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    """超級管理員可看到近期刪除事件，且依 entity_type 篩選正確。"""
    doc_row = await _make_audit_log(db_session, action="delete", entity_type="document")
    await _make_audit_log(db_session, action="archive", entity_type="regulation")
    # 非刪除類事件（不含關鍵字）不應出現
    await _make_audit_log(db_session, action="update", entity_type="document")

    ac = authed_client_factory(admin_user)
    response = await ac.get("/admin/trash", params={"entity_type": "document"})

    assert response.status_code == 200
    body = response.json()
    entity_ids = {item["entity_id"] for item in body}
    assert str(doc_row.entity_id) in entity_ids
    assert all(item["entity_type"] == "document" for item in body)


async def test_list_deletions_excludes_events_outside_day_window(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    """超過查詢天數範圍的刪除事件不應出現在列表中。"""
    old_row = await _make_audit_log(
        db_session,
        action="delete",
        entity_type="document",
        created_at=datetime.now(UTC) - timedelta(days=30),
    )

    ac = authed_client_factory(admin_user)
    response = await ac.get("/admin/trash", params={"days": 1})

    assert response.status_code == 200
    entity_ids = {item["entity_id"] for item in response.json()}
    assert str(old_row.entity_id) not in entity_ids


async def test_get_deletion_returns_detail(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    """依 audit_id 查詢單筆刪除事件詳情。"""
    row = await _make_audit_log(db_session, action="purge", entity_type="user")

    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/admin/trash/{row.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["audit_id"] == str(row.id)
    assert body["action"] == "purge"


async def test_get_deletion_missing_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    """不存在的 audit_id 應回傳 404。"""
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/admin/trash/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_get_deletion_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    """一般使用者不可查看單筆刪除事件詳情。"""
    row = await _make_audit_log(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.get(f"/admin/trash/{row.id}")
    assert response.status_code == 403
