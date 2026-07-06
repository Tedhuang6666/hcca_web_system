"""Admin Impersonation 路由 HTTP 層測試（apps/api/src/api/routers/impersonation.py）。

test_impersonation.py 只測 service 層的 token 建立/解析純函式；本檔補上
經過 FastAPI 路由與 admin:impersonate 權限檢查的行為：啟動代理登入、
禁止代理自己/未啟用帳號/不存在帳號、結束代理（撤銷 token）。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.security import is_blacklisted
from api.models.user import User
from api.services import impersonation as impersonation_svc

# ---------------------------------------------------------------------------
# POST /admin/impersonate/{target_user_id}
# ---------------------------------------------------------------------------


async def test_start_impersonation_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., Any],
) -> None:
    target = await make_user(email="target1@school.edu")
    ac = authed_client_factory(member_user)

    response = await ac.post(f"/admin/impersonate/{target.id}")

    assert response.status_code == 403


async def test_superuser_can_start_impersonation(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., Any],
) -> None:
    target = await make_user(email="target2@school.edu")
    ac = authed_client_factory(admin_user)

    response = await ac.post(f"/admin/impersonate/{target.id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["target_user_id"] == str(target.id)
    assert payload["target_email"] == target.email
    assert payload["expires_in_minutes"] == impersonation_svc.IMPERSONATION_DEFAULT_MINUTES
    assert payload["token"]


async def test_start_impersonation_with_custom_minutes(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., Any],
) -> None:
    target = await make_user(email="target3@school.edu")
    ac = authed_client_factory(admin_user)

    response = await ac.post(f"/admin/impersonate/{target.id}", json={"minutes": 5})

    assert response.status_code == 200
    assert response.json()["expires_in_minutes"] == 5


async def test_start_impersonation_for_nonexistent_user_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)

    response = await ac.post(f"/admin/impersonate/{uuid.uuid4()}")

    assert response.status_code == 404


async def test_start_impersonation_for_inactive_user_returns_400(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., Any],
) -> None:
    target = await make_user(email="inactive-target@school.edu", is_active=False)
    ac = authed_client_factory(admin_user)

    response = await ac.post(f"/admin/impersonate/{target.id}")

    assert response.status_code == 400


async def test_superuser_can_self_impersonate(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    """create_impersonation_token 只在「非 superuser 且 actor==target」時才擋自己。

    superuser 自我 impersonate 不會被 service 層擋下（見
    api/services/impersonation.py 的 `if not actor.is_superuser and actor.id == target.id`），
    因此這裡實際應該成功，而非 403。
    """
    ac = authed_client_factory(admin_user)

    response = await ac.post(f"/admin/impersonate/{admin_user.id}")

    assert response.status_code == 200


async def test_non_superuser_cannot_impersonate_self_even_with_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    """非 superuser 即使持有 admin:impersonate 權限，也不能 impersonate 自己。"""
    from datetime import timedelta

    from api.core.clock import local_today
    from api.core.permission_codes import PermissionCode
    from api.models.org import Org, Permission, Position, UserPosition

    actor = await make_user(email="self-impersonate-actor@school.edu")
    org = Org(name=f"代理登入自我測試組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="客服人員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=PermissionCode.ADMIN_IMPERSONATE))
    db_session.add(
        UserPosition(
            user_id=actor.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db_session.flush()

    ac = authed_client_factory(actor)
    response = await ac.post(f"/admin/impersonate/{actor.id}")

    assert response.status_code == 403


async def test_non_superuser_cannot_impersonate_superuser_even_with_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., Any],
    db_session: AsyncSession,
) -> None:
    """actor 有 admin:impersonate 權限但非 superuser，仍不可代理另一個 superuser。"""
    from datetime import timedelta

    from api.core.clock import local_today
    from api.core.permission_codes import PermissionCode
    from api.models.org import Org, Permission, Position, UserPosition

    actor = await make_user(email="impersonate-actor@school.edu")
    target_superuser = await make_user(
        email="target-superuser@school.edu", is_superuser=True, mfa_enabled=True
    )

    org = Org(name=f"代理登入測試組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="客服人員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=PermissionCode.ADMIN_IMPERSONATE))
    db_session.add(
        UserPosition(
            user_id=actor.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db_session.flush()

    ac = authed_client_factory(actor)
    response = await ac.post(f"/admin/impersonate/{target_superuser.id}")

    assert response.status_code == 403


async def test_superuser_can_impersonate_another_superuser(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., Any],
) -> None:
    other_admin = await make_user(
        email="other-admin@school.edu", is_superuser=True, mfa_enabled=True
    )
    ac = authed_client_factory(admin_user)

    response = await ac.post(f"/admin/impersonate/{other_admin.id}")

    assert response.status_code == 200


async def test_start_impersonation_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.post(f"/admin/impersonate/{uuid.uuid4()}")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /admin/impersonate/end
#
# /end 必須註冊在 /{target_user_id} 之前，否則 "end" 會先被當成
# {target_user_id} 路徑參數嘗試轉型為 UUID 而以 422 失敗，永遠打不到這支端點
# （曾經是個真實 bug，已在 impersonation.py 修正註冊順序）。
# ---------------------------------------------------------------------------


async def test_end_impersonation_revokes_token(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., Any],
) -> None:
    target = await make_user(email="end-target@school.edu")
    ac = authed_client_factory(admin_user)

    start_resp = await ac.post(f"/admin/impersonate/{target.id}")
    token = start_resp.json()["token"]

    end_resp = await ac.post("/admin/impersonate/end", json={"token": token})

    assert end_resp.status_code == 204
    assert await is_blacklisted(token) is True


async def test_end_impersonation_without_permission_still_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    """未授權使用者呼叫 /end 仍會先被權限檢查擋下（403），意外地掩蓋了上述路由 bug。"""
    ac = authed_client_factory(member_user)

    response = await ac.post("/admin/impersonate/end", json={"token": "whatever"})

    assert response.status_code == 403
