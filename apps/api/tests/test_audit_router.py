"""稽核日誌查詢路由測試（apps/api/src/api/routers/audit.py）。

test_audit_chain.py 測的是雜湊鏈 service（audit_chain.py），完全不同模組；
本檔測 /audit-logs 與 /audit-logs/export.csv 這兩個查詢端點：權限分級
（audit:view_org vs audit:view_all）、系統代碼篩選、CSV 匯出格式。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.permission_codes import PermissionCode
from api.models.audit_log import AuditLog
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User


def _authed(factory: Callable[[User], AsyncClient], user: User) -> AsyncClient:
    import secrets

    ac = factory(user)
    token = secrets.token_urlsafe(32)
    ac.cookies.set("csrf_token", token)
    ac._csrf_token = token
    return ac


def _make_log(**overrides: Any) -> AuditLog:
    """AuditLog.created_at 無 ORM 層預設值，實際寫入一律經 audit_svc.record /
    audit_chain 補上；測試直接建 row 時需自行帶入，否則違反 NOT NULL 約束。"""
    defaults: dict[str, Any] = {"meta": {}, "created_at": datetime.now(UTC)}
    defaults.update(overrides)
    return AuditLog(**defaults)


async def _grant(
    db: AsyncSession, user: User, org: Org, code: str, *, position_name: str = "職位"
) -> None:
    position = Position(org_id=org.id, name=position_name)
    db.add(position)
    await db.flush()
    db.add(Permission(position_id=position.id, code=code))
    db.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db.flush()


# ---------------------------------------------------------------------------
# GET /audit-logs
# ---------------------------------------------------------------------------


async def test_list_audit_logs_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.get("/audit-logs")
    assert response.status_code == 401


async def test_list_audit_logs_without_any_audit_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.get("/audit-logs")
    assert response.status_code == 403


async def test_superuser_can_list_audit_logs(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    db_session.add(
        _make_log(
            entity_type="document",
            entity_id=str(uuid.uuid4()),
            action="approve",
            actor_id=str(admin_user.id),
            actor_email=admin_user.email,
            summary="測試稽核紀錄",
        )
    )
    await db_session.flush()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get("/audit-logs")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_audit_view_org_only_permission_scopes_to_own_org(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    """audit:view_org（無 view_all/admin:all）只能看到與自己組織相關的紀錄：
    entity_type=="org" 且 entity_id 命中、或 meta.org_id / meta.custom_permission_org_id
    命中自己所屬組織；其餘組織的紀錄不可見。

    對應修法：apps/api/src/api/routers/audit.py 原用 `AuditLog.meta[...].astext`，
    但欄位型別 `JSON().with_variant(JSONB, "postgresql")` 產生的 comparator 是通用
    `JSON.Comparator`，不具備 JSONB 專屬的 `.astext`，一律 AttributeError。已改用
    `JSON.Comparator` 本身就有的 `.as_string()`（兩種 comparator 皆具備）。
    """
    viewer = await make_user(email="audit-org-viewer@school.edu")
    org = Org(name=f"稽核測試組織-{uuid.uuid4().hex[:6]}")
    other_org = Org(name=f"稽核測試組織-其他-{uuid.uuid4().hex[:6]}")
    db_session.add_all([org, other_org])
    await db_session.flush()
    await _grant(db_session, viewer, org, PermissionCode.AUDIT_VIEW_ORG)

    own_org_entity_log = _make_log(
        entity_type="org",
        entity_id=str(org.id),
        action="update",
        summary="組織內紀錄",
    )
    own_org_meta_log = _make_log(
        entity_type="document",
        entity_id=str(uuid.uuid4()),
        action="approve",
        meta={"org_id": str(org.id)},
        summary="組織內文件",
    )
    other_org_log = _make_log(
        entity_type="org",
        entity_id=str(other_org.id),
        action="update",
        summary="其他組織紀錄",
    )
    db_session.add_all([own_org_entity_log, own_org_meta_log, other_org_log])
    await db_session.flush()

    ac = _authed(authed_client_factory, viewer)
    response = await ac.get("/audit-logs")

    assert response.status_code == 200
    entity_ids = {row["entity_id"] for row in response.json()}
    assert str(org.id) in entity_ids
    assert own_org_meta_log.entity_id in entity_ids
    assert str(other_org.id) not in entity_ids


async def test_filter_by_system_code_narrows_entity_types(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    db_session.add(_make_log(entity_type="regulation", entity_id=str(uuid.uuid4()), action="publish"))
    db_session.add(_make_log(entity_type="document", entity_id=str(uuid.uuid4()), action="issue"))
    await db_session.flush()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get("/audit-logs", params={"system": "regulation"})

    assert response.status_code == 200
    for row in response.json():
        assert row["entity_type"] in ("regulation", "regulation_article")


# ---------------------------------------------------------------------------
# GET /audit-logs/export.csv
# ---------------------------------------------------------------------------


async def test_export_csv_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.get("/audit-logs/export.csv")
    assert response.status_code == 403


async def test_export_csv_returns_utf8_bom_csv(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    db_session.add(
        _make_log(
            entity_type="document",
            entity_id=str(uuid.uuid4()),
            action="issue",
            actor_email=admin_user.email,
            meta={"foo": "bar"},
            summary="匯出測試",
        )
    )
    await db_session.flush()

    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get("/audit-logs/export.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert response.text.startswith("﻿")
    assert "created_at,action,entity_type" in response.text
