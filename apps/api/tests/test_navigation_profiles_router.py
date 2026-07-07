"""角色視角導覽設定路由測試（apps/api/src/api/routers/navigation_profiles.py）。

測試資料庫是用 Base.metadata.create_all 直接建 schema（見 conftest.py
_build_schema_once），不會跑 alembic migration，所以 migration
20260701090000_add_navigation_profiles.py 灌的三個系統預設視角
（mealVendor / teacher / default）在測試裡並不存在，各測試需自行造資料。
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from api.models.navigation_profile import NavigationProfile
from api.models.org import Org, Permission, Position, UserPosition


async def _seed_profile(db_session, **overrides: Any) -> NavigationProfile:
    defaults: dict[str, Any] = {
        "key": f"profile-{uuid.uuid4().hex[:8]}",
        "label": "測試視角",
        "priority": 100,
        "is_active": True,
        "is_system": False,
        "match_any_permissions": [],
        "match_any_prefixes": [],
        "exclude_permissions": [],
        "exclude_prefixes": [],
        "desktop_sections": [],
        "mobile_order": [],
    }
    defaults.update(overrides)
    profile = NavigationProfile(**defaults)
    db_session.add(profile)
    await db_session.flush()
    return profile


async def test_list_navigation_profiles_without_login_returns_401(client) -> None:
    resp = await client.get("/admin/navigation-profiles")
    assert resp.status_code == 401


async def test_list_navigation_profiles_by_member_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/admin/navigation-profiles")
    assert resp.status_code == 403


async def test_list_navigation_profiles_by_admin_includes_created_profiles(
    admin_user, authed_client_factory, db_session
) -> None:
    await _seed_profile(db_session, key="listed-a", label="視角 A")
    await _seed_profile(db_session, key="listed-b", label="視角 B")

    ac = authed_client_factory(admin_user)
    resp = await ac.get("/admin/navigation-profiles")
    assert resp.status_code == 200
    keys = {row["key"] for row in resp.json()}
    assert {"listed-a", "listed-b"} <= keys


async def test_resolve_my_navigation_profile_falls_back_to_default(
    member_user, authed_client_factory, db_session
) -> None:
    await _seed_profile(db_session, key="default", label="完整平台視角", priority=1000)

    ac = authed_client_factory(member_user)
    resp = await ac.get("/admin/navigation-profiles/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "default"
    assert body["profile"]["key"] == "default"


async def test_create_navigation_profile_by_member_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/admin/navigation-profiles", json={"key": "custom1", "label": "自訂視角"})
    assert resp.status_code == 403


async def test_create_navigation_profile_with_unknown_position_returns_400(
    admin_user, authed_client_factory
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        "/admin/navigation-profiles",
        json={"key": "custom-bad-pos", "label": "自訂視角", "position_ids": [str(uuid.uuid4())]},
    )
    assert resp.status_code == 400


async def test_create_update_delete_navigation_profile(admin_user, authed_client_factory) -> None:
    ac = authed_client_factory(admin_user)
    created = await ac.post(
        "/admin/navigation-profiles",
        json={"key": "custom2", "label": "自訂視角2", "priority": 500},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["is_system"] is False
    profile_id = body["id"]

    updated = await ac.patch(f"/admin/navigation-profiles/{profile_id}", json={"label": "改名視角"})
    assert updated.status_code == 200
    assert updated.json()["label"] == "改名視角"

    deleted = await ac.delete(f"/admin/navigation-profiles/{profile_id}")
    assert deleted.status_code == 204

    listed = await ac.get("/admin/navigation-profiles")
    assert all(row["id"] != profile_id for row in listed.json())


async def test_update_missing_navigation_profile_returns_404(
    admin_user, authed_client_factory
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.patch(f"/admin/navigation-profiles/{uuid.uuid4()}", json={"label": "x"})
    assert resp.status_code == 404


async def test_delete_missing_navigation_profile_returns_404(
    admin_user, authed_client_factory
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.delete(f"/admin/navigation-profiles/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_delete_system_profile_returns_400(
    admin_user, authed_client_factory, db_session
) -> None:
    system_profile = await _seed_profile(db_session, key="system-locked", is_system=True)

    ac = authed_client_factory(admin_user)
    resp = await ac.delete(f"/admin/navigation-profiles/{system_profile.id}")
    assert resp.status_code == 400


async def test_resolve_prefers_position_match_over_default(
    member_user, admin_user, authed_client_factory, db_session
) -> None:
    org = Org(name=f"視角測試組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="視角測試職位")
    db_session.add(position)
    await db_session.flush()
    db_session.add(
        UserPosition(user_id=member_user.id, position_id=position.id, start_date=date.today())
    )
    await db_session.flush()

    admin_ac = authed_client_factory(admin_user)
    created = await admin_ac.post(
        "/admin/navigation-profiles",
        json={
            "key": "custom-position",
            "label": "職位專屬視角",
            "priority": 5,
            "position_ids": [str(position.id)],
        },
    )
    assert created.status_code == 201

    member_ac = authed_client_factory(member_user)
    resp = await member_ac.get("/admin/navigation-profiles/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "position"
    assert body["profile"]["key"] == "custom-position"


async def test_resolve_matches_by_permission_when_no_position_link(
    member_user, authed_client_factory, db_session
) -> None:
    """member 持有 survey:review 權限（但職位未綁定任何視角）應匹配權限式視角。"""
    await _seed_profile(
        db_session,
        key="reviewer-view",
        priority=20,
        match_any_permissions=["survey:review"],
    )
    org = Org(name=f"視角權限組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="審核委員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code="survey:review"))
    db_session.add(
        UserPosition(user_id=member_user.id, position_id=position.id, start_date=date.today())
    )
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/admin/navigation-profiles/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "permission"
    assert body["profile"]["key"] == "reviewer-view"
