"""殭屍權限稽核路由測試（apps/api/src/api/routers/admin.py:list_zombie_credentials）。

涵蓋登入/權限檢查，以及任期已過但仍持有 API key / webhook / session 的帳號
是否被正確列出（無任何長效憑證者不應出現）。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.api_key import ApiKey
from api.models.org import Org, Position, UserPosition
from api.models.user import User
from api.models.webhook import WebhookSubscription


async def _expired_position(db_session: AsyncSession, user: User, *, days_ago: int = 30) -> None:
    org = Org(name=f"org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="幹部")
    db_session.add(position)
    await db_session.flush()
    end_date = local_today() - timedelta(days=days_ago)
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=end_date - timedelta(days=365),
            end_date=end_date,
        )
    )
    await db_session.flush()


async def test_zombie_credentials_requires_login(client: AsyncClient) -> None:
    response = await client.get("/admin/zombie-credentials")
    assert response.status_code == 401


async def test_zombie_credentials_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/admin/zombie-credentials")
    assert response.status_code == 403


async def test_zombie_credentials_excludes_user_without_credentials(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    stale_user = await make_user(email="stale-nocred@school.edu")
    await _expired_position(db_session, stale_user)

    ac = authed_client_factory(admin_user)
    response = await ac.get("/admin/zombie-credentials")
    assert response.status_code == 200
    ids = {row["user_id"] for row in response.json()}
    assert str(stale_user.id) not in ids


async def test_zombie_credentials_lists_user_with_active_api_key(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    stale_user = await make_user(email="stale-withkey@school.edu")
    await _expired_position(db_session, stale_user)
    db_session.add(
        ApiKey(
            name="殭屍 key",
            key_prefix="zbkey123",
            key_hash=uuid.uuid4().hex,
            owner_user_id=stale_user.id,
            is_active=True,
        )
    )
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.get("/admin/zombie-credentials")
    assert response.status_code == 200
    rows = {row["user_id"]: row for row in response.json()}
    assert str(stale_user.id) in rows
    entry = rows[str(stale_user.id)]
    assert entry["active_api_keys"] == 1
    assert entry["active_webhooks"] == 0


async def test_zombie_credentials_lists_user_with_active_webhook(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    stale_user = await make_user(email="stale-withwebhook@school.edu")
    await _expired_position(db_session, stale_user)
    db_session.add(
        WebhookSubscription(
            name="殭屍 webhook",
            owner_user_id=stale_user.id,
            url="https://example.org/hook",
            secret="s3cr3t",
            is_active=True,
        )
    )
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.get("/admin/zombie-credentials")
    assert response.status_code == 200
    rows = {row["user_id"]: row for row in response.json()}
    assert str(stale_user.id) in rows
    assert rows[str(stale_user.id)]["active_webhooks"] == 1


async def test_zombie_credentials_excludes_revoked_api_key(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    stale_user = await make_user(email="stale-revoked@school.edu")
    await _expired_position(db_session, stale_user)
    db_session.add(
        ApiKey(
            name="已撤銷 key",
            key_prefix="revoked12",
            key_hash=uuid.uuid4().hex,
            owner_user_id=stale_user.id,
            is_active=True,
            revoked_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.get("/admin/zombie-credentials")
    assert response.status_code == 200
    ids = {row["user_id"] for row in response.json()}
    assert str(stale_user.id) not in ids


async def test_zombie_credentials_excludes_active_position(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    active_user = await make_user(email="still-active@school.edu")
    org = Org(name=f"org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="現任幹部")
    db_session.add(position)
    await db_session.flush()
    db_session.add(
        UserPosition(
            user_id=active_user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=10),
            end_date=None,
        )
    )
    db_session.add(
        ApiKey(
            name="現任者 key",
            key_prefix="stillact1",
            key_hash=uuid.uuid4().hex,
            owner_user_id=active_user.id,
            is_active=True,
        )
    )
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.get("/admin/zombie-credentials")
    assert response.status_code == 200
    ids = {row["user_id"] for row in response.json()}
    assert str(active_user.id) not in ids
