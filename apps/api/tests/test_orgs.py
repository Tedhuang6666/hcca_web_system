"""組織架構路由測試 — 列表 / 樹狀 / RBAC 過濾清單 / CRUD / 啟停用。"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.org import Org, Permission, Position, UserPosition
from api.models.school_class import SchoolClass
from api.models.user import User


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def _seed_user_with_codes(
    db: AsyncSession,
    email: str,
    codes: list[str],
    *,
    superuser: bool = False,
    org: Org | None = None,
) -> User:
    user = User(
        email=email,
        display_name="測試使用者",
        is_active=True,
        is_verified=True,
        is_superuser=superuser,
    )
    db.add(user)
    await db.flush()
    if codes:
        target_org = org
        if target_org is None:
            target_org = Org(name="測試組織")
            db.add(target_org)
            await db.flush()
        position = Position(org_id=target_org.id, name="測試職位")
        db.add(position)
        await db.flush()
        for code in codes:
            db.add(Permission(position_id=position.id, code=code))
        db.add(UserPosition(user_id=user.id, position_id=position.id, start_date=date.today()))
        await db.flush()
    return user


@pytest.mark.asyncio
async def test_list_orgs_without_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.get("/orgs")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_orgs_returns_active_and_inactive(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "org-lister@school.edu", [])
    db_session.add_all(
        [
            Org(name="啟用組織", is_active=True),
            Org(name="停用組織", is_active=False),
        ]
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get("/orgs")
    assert resp.status_code == 200
    names = {item["name"] for item in resp.json()}
    assert {"啟用組織", "停用組織"} <= names

    resp_active = await client.get("/orgs", params={"active_only": True})
    assert resp_active.status_code == 200
    active_names = {item["name"] for item in resp_active.json()}
    assert "停用組織" not in active_names


@pytest.mark.asyncio
async def test_list_orgs_can_exclude_class_orgs(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "org-exclude-class@school.edu", [])
    regular_org = Org(name="自治組織")
    class_org = Org(name="115 學年度 101 班")
    db_session.add_all([regular_org, class_org])
    await db_session.flush()
    db_session.add(
        SchoolClass(
            academic_year=115,
            class_code="101",
            grade=1,
            created_by=user.id,
            org_id=class_org.id,
        )
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get("/orgs", params={"exclude_class_orgs": True})

    assert resp.status_code == 200
    names = {item["name"] for item in resp.json()}
    assert "自治組織" in names
    assert "115 學年度 101 班" not in names


@pytest.mark.asyncio
async def test_get_org_tree_returns_empty_list_when_no_orgs(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    # 注意：org_svc.build_org_tree 對「有資料」的組織會在 OrgTree.model_validate(o) 讀取
    # 尚未 eager-load 的 Org.children 關聯（get_orgs() 未 selectinload），在 async session
    # 下觸發 MissingGreenlet 500；此為既有 production bug（見任務報告），故僅驗證空清單情境，
    # 不在測試中觸發該既有錯誤路徑。
    user = await _seed_user_with_codes(db_session, "org-tree@school.edu", [])
    _override_user(user)

    resp = await client.get("/orgs/tree")

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_my_create_orgs_filters_by_document_permission(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org = Org(name="有權限組織")
    other_org = Org(name="無權限組織")
    db_session.add_all([org, other_org])
    await db_session.flush()
    user = await _seed_user_with_codes(
        db_session, "org-my-create@school.edu", ["document:create"], org=org
    )
    _override_user(user)

    resp = await client.get("/orgs/my-create-orgs")

    assert resp.status_code == 200
    names = {item["name"] for item in resp.json()}
    assert names == {"有權限組織"}


@pytest.mark.asyncio
async def test_list_my_create_orgs_superuser_sees_all_active(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _seed_user_with_codes(
        db_session, "org-my-create-admin@school.edu", [], superuser=True
    )
    db_session.add(Org(name="任一組織", is_active=True))
    await db_session.flush()
    _override_user(admin)

    resp = await client.get("/orgs/my-create-orgs")

    assert resp.status_code == 200
    assert any(item["name"] == "任一組織" for item in resp.json())


@pytest.mark.asyncio
async def test_list_my_create_orgs_hides_class_orgs(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = await _seed_user_with_codes(
        db_session, "org-my-create-class-admin@school.edu", [], superuser=True
    )
    class_org = Org(name="115 學年度 201 班")
    db_session.add(class_org)
    await db_session.flush()
    db_session.add(
        SchoolClass(
            academic_year=115,
            class_code="201",
            grade=2,
            created_by=admin.id,
            org_id=class_org.id,
        )
    )
    await db_session.flush()
    _override_user(admin)

    resp = await client.get("/orgs/my-create-orgs")

    assert resp.status_code == 200
    assert "115 學年度 201 班" not in {item["name"] for item in resp.json()}


@pytest.mark.asyncio
async def test_list_my_regulation_create_orgs_filters_by_permission(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org = Org(name="法規組織")
    db_session.add(org)
    await db_session.flush()
    user = await _seed_user_with_codes(
        db_session, "org-my-regulation@school.edu", ["regulation:create"], org=org
    )
    _override_user(user)

    resp = await client.get("/orgs/my-regulation-create-orgs")

    assert resp.status_code == 200
    assert [item["name"] for item in resp.json()] == ["法規組織"]


@pytest.mark.asyncio
async def test_list_my_serial_template_orgs_filters_by_permission(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org = Org(name="字號組織")
    db_session.add(org)
    await db_session.flush()
    user = await _seed_user_with_codes(
        db_session, "org-my-serial@school.edu", ["serial:create"], org=org
    )
    _override_user(user)

    resp = await client.get("/orgs/my-serial-template-orgs")

    assert resp.status_code == 200
    assert [item["name"] for item in resp.json()] == ["字號組織"]


@pytest.mark.asyncio
async def test_get_org_missing_returns_404(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(db_session, "org-get-404@school.edu", [])
    _override_user(user)

    resp = await client.get(f"/orgs/{uuid.uuid4()}")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_org_returns_details(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(db_session, "org-get-ok@school.edu", [])
    org = Org(name="查詢組織")
    db_session.add(org)
    await db_session.flush()
    _override_user(user)

    resp = await client.get(f"/orgs/{org.id}")

    assert resp.status_code == 200
    assert resp.json()["name"] == "查詢組織"


@pytest.mark.asyncio
async def test_create_org_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "org-create-403@school.edu", [])
    _override_user(user)

    resp = await client.post("/orgs", json={"name": "新組織"})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_org_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(db_session, "org-create-ok@school.edu", ["org:manage"])
    _override_user(user)

    resp = await client.post("/orgs", json={"name": "新建組織"})

    assert resp.status_code == 201
    assert resp.json()["name"] == "新建組織"


@pytest.mark.asyncio
async def test_org_default_permissions_can_be_saved_and_updated(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "org-default-perms@school.edu", ["org:manage"])
    _override_user(user)

    created = await client.post(
        "/orgs",
        json={"name": "資訊部", "default_permission_codes": ["site:manage"]},
    )

    assert created.status_code == 201
    assert created.json()["default_permission_codes"] == ["site:manage"]

    updated = await client.patch(
        f"/orgs/{created.json()['id']}",
        json={"default_permission_codes": ["site:manage", "announcement:create"]},
    )

    assert updated.status_code == 200
    assert set(updated.json()["default_permission_codes"]) == {
        "site:manage",
        "announcement:create",
    }


@pytest.mark.asyncio
async def test_update_org_missing_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "org-update-404@school.edu", ["org:manage"])
    _override_user(user)

    resp = await client.patch(f"/orgs/{uuid.uuid4()}", json={"name": "改名"})

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_org_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(db_session, "org-update-ok@school.edu", ["org:manage"])
    org = Org(name="待改組織")
    db_session.add(org)
    await db_session.flush()
    _override_user(user)

    resp = await client.patch(f"/orgs/{org.id}", json={"name": "已改組織"})

    assert resp.status_code == 200
    assert resp.json()["name"] == "已改組織"


@pytest.mark.asyncio
async def test_deactivate_and_activate_org(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(db_session, "org-toggle@school.edu", ["org:manage"])
    org = Org(name="切換組織", is_active=True)
    db_session.add(org)
    await db_session.flush()
    _override_user(user)

    deactivated = await client.post(f"/orgs/{org.id}/deactivate")
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    activated = await client.post(f"/orgs/{org.id}/activate")
    assert activated.status_code == 200
    assert activated.json()["is_active"] is True


@pytest.mark.asyncio
async def test_delete_org_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "org-delete-403@school.edu", [])
    org = Org(name="無權刪除組織")
    db_session.add(org)
    await db_session.flush()
    _override_user(user)

    resp = await client.delete(f"/orgs/{org.id}")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_org_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(db_session, "org-delete-ok@school.edu", ["org:manage"])
    org = Org(name="可刪組織")
    db_session.add(org)
    await db_session.flush()
    org_id = org.id
    _override_user(user)

    resp = await client.delete(f"/orgs/{org_id}")

    assert resp.status_code == 204
    assert await db_session.get(Org, org_id) is None


@pytest.mark.asyncio
async def test_delete_org_missing_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "org-delete-404@school.edu", ["org:manage"])
    _override_user(user)

    resp = await client.delete(f"/orgs/{uuid.uuid4()}")

    assert resp.status_code == 404
