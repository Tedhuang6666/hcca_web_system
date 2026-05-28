"""Admin system defense controls."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import app
from api.core.defense import default_rate_limit_config, publish_rules, set_rate_limit_config
from api.core.ip_blocklist import clear_cache as clear_ip_block_cache
from api.core.rate_limit import _memory_buckets
from api.dependencies.auth import get_current_active_user
from api.models.audit_log import AuditLog
from api.models.user import User


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def _seed_users(db: AsyncSession) -> tuple[User, User]:
    admin = User(
        email="security-admin@school.edu",
        display_name="資安管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    member = User(
        email="member@school.edu",
        display_name="一般使用者",
        is_active=True,
        is_verified=True,
    )
    db.add_all([admin, member])
    await db.flush()
    return admin, member


async def _reset_defense_cache() -> None:
    await publish_rules([])
    await set_rate_limit_config(default_rate_limit_config())
    clear_ip_block_cache()
    _memory_buckets.clear()


async def test_non_admin_cannot_access_defense_summary(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, member = await _seed_users(db_session)
    _override_user(member)

    response = await client.get("/admin/system/defense/summary")

    assert response.status_code == 403


async def test_admin_create_defense_rule_syncs_redis_and_audit_log(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _reset_defense_cache()
    admin, _ = await _seed_users(db_session)
    _override_user(admin)

    response = await client.post(
        "/admin/system/defense/rules",
        json={
            "rule_type": "ip_block",
            "target": "203.0.113.10",
            "reason": "test block",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["rule_type"] == "ip_block"
    assert payload["target"] == "203.0.113.10"

    summary = await client.get("/admin/system/defense/summary")
    assert summary.status_code == 200
    assert summary.json()["active_by_type"]["ip_block"] == 1

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.entity_type == "defense_rule",
            AuditLog.action == "create",
        )
    )
    assert result.scalar_one_or_none() is not None


async def test_cidr_block_hits_middleware_and_allowlist_wins(client: AsyncClient) -> None:
    clear_ip_block_cache()
    await publish_rules(
        [
            {
                "rule_type": "ip_block",
                "target": "127.0.0.1",
                "reason": "test block",
                "expires_at": None,
            },
            {
                "rule_type": "ip_block",
                "target": "testclient",
                "reason": "test block",
                "expires_at": None,
            },
            {
                "rule_type": "ip_block",
                "target": "test",
                "reason": "test block",
                "expires_at": None,
            },
        ]
    )

    blocked = await client.get("/health")
    assert blocked.status_code == 403

    await publish_rules(
        [
            {
                "rule_type": "ip_allow",
                "target": "127.0.0.1",
                "reason": "trusted test client",
                "expires_at": None,
            },
            {
                "rule_type": "ip_allow",
                "target": "testclient",
                "reason": "trusted test client",
                "expires_at": None,
            },
            {
                "rule_type": "ip_allow",
                "target": "test",
                "reason": "trusted test client",
                "expires_at": None,
            },
            {
                "rule_type": "ip_block",
                "target": "127.0.0.1",
                "reason": "test block",
                "expires_at": None,
            },
            {
                "rule_type": "ip_block",
                "target": "testclient",
                "reason": "test block",
                "expires_at": None,
            },
            {
                "rule_type": "ip_block",
                "target": "test",
                "reason": "test block",
                "expires_at": None,
            },
        ]
    )

    allowed = await client.get("/health")
    assert allowed.status_code == 200
    await _reset_defense_cache()


async def test_rate_limit_override_returns_429(client: AsyncClient) -> None:
    await _reset_defense_cache()
    path = f"/defense-rate-limit-test-{uuid.uuid4().hex}"
    await set_rate_limit_config(
        {
            "enabled": True,
            "global_requests": 1000,
            "global_window_seconds": 60,
            "overrides": [{"path_prefix": path, "requests": 1, "window_seconds": 60}],
        }
    )

    first = await client.get(path)
    second = await client.get(path)

    assert first.status_code == 404
    assert second.status_code == 429
    assert second.headers["Retry-After"] == "60"
    await _reset_defense_cache()
