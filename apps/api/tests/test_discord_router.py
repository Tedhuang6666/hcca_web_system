"""Discord 整合路由測試（apps/api/src/api/routers/discord.py）。

OAuth 綁定流程 mock authlib client（同 test_user_google_tasks.py 手法）；
guild/channel/role 選項透過 discord_gateway.write_inventory() 寫入真實（隔離）
測試 redis 後端，模擬 bot process 回報的 inventory 快照，不需 mock 底層函式。
enqueue_role_sync 等一律走 outbox（DB 寫入即完成），無外部即時呼叫。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi.responses import RedirectResponse
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.discord_account import DiscordAccountLink
from api.models.org import Org, Position
from api.models.user import User
from api.services import discord_bot as discord_bot_svc
from api.services import discord_gateway


@pytest.fixture
def discord_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DISCORD_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "DISCORD_CLIENT_SECRET", "test-client-secret")


@pytest.fixture
def discord_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    # 本機開發 .env 可能已填入真實 Discord OAuth 憑證；顯式清空以驗證未設定分支，
    # 不能只靠 config.py 的空字串預設值。
    monkeypatch.setattr(settings, "DISCORD_CLIENT_ID", "")
    monkeypatch.setattr(settings, "DISCORD_CLIENT_SECRET", "")


@pytest_asyncio.fixture(autouse=True)
async def _clear_discord_inventory() -> None:
    # Redis 測試隔離 fixture 只重建連線池、不清資料，故不同測試寫入的 bot
    # inventory 快照會殘留到下一個測試；每個測試前先清掉，需要的測試自行 seed。
    from api.core.security import redis_client
    from api.services.discord_gateway import _INVENTORY_KEY

    await redis_client.delete(_INVENTORY_KEY)


async def _seed_guild_inventory(**overrides: object) -> None:
    guild = {
        "id": "guild-1",
        "name": "測試伺服器",
        "icon": None,
        "roles": [{"id": "role-1", "name": "幹部", "color": 0, "position": 1, "managed": False}],
        "channels": [{"id": "chan-1", "name": "公告", "type": 0, "parent_id": None}],
    }
    guild.update(overrides)
    await discord_gateway.write_inventory(
        {"bot_user_id": "bot-1", "bot_username": "HCCA Bot", "guilds": [guild]}
    )


# ── OAuth 綁定流程 ────────────────────────────────────────────────────────────


async def test_discord_login_not_configured_returns_503(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    discord_not_configured: None,
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/discord/login")
    assert response.status_code == 503


async def test_discord_login_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/discord/login")
    assert response.status_code == 401


async def test_discord_login_redirects_to_oauth(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    discord_configured: None,
) -> None:
    ac = authed_client_factory(member_user)
    fake_redirect = RedirectResponse(url="https://discord.com/api/oauth2/authorize?fake=1")
    with patch("api.core.oauth.discord.authorize_redirect", AsyncMock(return_value=fake_redirect)):
        response = await ac.get("/discord/login", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert "discord.com" in response.headers["location"]


async def test_discord_callback_without_session_redirects_missing_session(
    client: AsyncClient,
) -> None:
    response = await client.get("/discord/callback", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert "discord=missing-session" in response.headers["location"]


async def test_discord_callback_oauth_error_redirects(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    discord_configured: None,
) -> None:
    from authlib.integrations.base_client import OAuthError

    ac = authed_client_factory(member_user)
    fake_redirect = RedirectResponse(url="https://discord.com/api/oauth2/authorize?fake=1")
    with patch("api.core.oauth.discord.authorize_redirect", AsyncMock(return_value=fake_redirect)):
        await ac.get("/discord/login", follow_redirects=False)

    with patch(
        "api.core.oauth.discord.authorize_access_token",
        AsyncMock(side_effect=OAuthError(error="access_denied")),
    ):
        response = await ac.get("/discord/callback", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert "discord=oauth-failed" in response.headers["location"]


async def test_discord_callback_success_links_account(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    discord_configured: None,
    db_session: AsyncSession,
) -> None:
    ac = authed_client_factory(member_user)
    fake_redirect = RedirectResponse(url="https://discord.com/api/oauth2/authorize?fake=1")
    with patch("api.core.oauth.discord.authorize_redirect", AsyncMock(return_value=fake_redirect)):
        await ac.get("/discord/login", follow_redirects=False)

    class _FakeUserInfoResponse:
        def json(self) -> dict:
            return {"id": "discord-user-123", "username": "tester", "global_name": "Tester"}

    with (
        patch("api.core.oauth.discord.authorize_access_token", AsyncMock(return_value={})),
        patch("api.core.oauth.discord.get", AsyncMock(return_value=_FakeUserInfoResponse())),
    ):
        response = await ac.get("/discord/callback", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert "discord=linked" in response.headers["location"]

    link = await discord_bot_svc.get_user_link(db_session, member_user.id)
    assert link is not None
    assert link.discord_user_id == "discord-user-123"


# ── 我的綁定 ──────────────────────────────────────────────────────────────────


async def test_get_my_discord_binding_unlinked(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/discord/me")
    assert response.status_code == 200
    assert response.json()["linked"] is False


async def test_delete_my_discord_binding_noop_when_absent(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.delete("/discord/me")
    assert response.status_code == 204


async def test_sync_my_discord_requires_login(client: AsyncClient) -> None:
    response = await client.post("/discord/me/sync")
    assert response.status_code == 401


async def test_sync_my_discord_noop_when_unlinked(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.post("/discord/me/sync")
    assert response.status_code == 204


# ── 短效自動登入 ──────────────────────────────────────────────────────────────


async def test_open_from_discord_invalid_token_redirects_login(client: AsyncClient) -> None:
    response = await client.get("/discord/open", params={"token": "no-such-token"})
    assert response.status_code in (302, 307)
    assert "/login" in response.headers["location"]


async def test_open_from_discord_valid_token_sets_cookies(
    client: AsyncClient, member_user: User
) -> None:
    url = await discord_bot_svc.create_open_url(member_user.id, "/dashboard")
    token = url.rsplit("token=", 1)[-1]
    response = await client.get("/discord/open", params={"token": token})
    assert response.status_code in (302, 307)
    assert response.headers["location"].endswith("/dashboard")
    assert settings.ACCESS_TOKEN_COOKIE_NAME in response.cookies


# ── 管理端點：guild-configs / health / sync-all / test-message ────────────────


async def test_list_guild_configs_requires_admin_all(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/discord/guild-configs")
    assert response.status_code == 403


async def test_upsert_and_list_guild_config(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/discord/guild-configs", json={"guild_id": "guild-1", "name": "測試伺服器"}
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["guild_id"] == "guild-1"

    list_resp = await ac.get("/discord/guild-configs")
    assert list_resp.status_code == 200
    assert any(row["guild_id"] == "guild-1" for row in list_resp.json())


async def test_discord_health_reports_snapshot(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    await _seed_guild_inventory()
    ac = authed_client_factory(admin_user)
    response = await ac.get("/discord/health")
    assert response.status_code == 200
    body = response.json()
    assert body["bot_configured"] is True
    assert body["bot_user_id"] == "bot-1"


async def test_sync_all_discord_members_queues_linked_users(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    linked_user = await make_user(email="discord-linked@school.edu")
    db_session.add(
        DiscordAccountLink(
            id=uuid.uuid4(),
            user_id=linked_user.id,
            discord_user_id="d-1",
            username="linked",
            is_active=True,
            linked_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.post("/discord/sync-all")
    assert response.status_code == 200
    assert response.json()["queued"] >= 1


async def test_send_test_message_requires_admin_all(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.post(
        "/discord/test-message", json={"channel_id": "chan-1", "message": "hi"}
    )
    assert response.status_code == 403


async def test_send_test_message_succeeds(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/discord/test-message", json={"channel_id": "chan-1", "message": "測試"}
    )
    assert response.status_code == 204


# ── guild 選項（inventory 讀取）──────────────────────────────────────────────


async def test_available_guilds_not_configured_returns_503(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    discord_not_configured: None,
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get("/discord/available-guilds")
    assert response.status_code == 503


async def test_available_guilds_bot_offline_returns_503(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    discord_configured: None,
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get("/discord/available-guilds")
    assert response.status_code == 503


async def test_available_guilds_returns_inventory(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    discord_configured: None,
) -> None:
    await _seed_guild_inventory()
    ac = authed_client_factory(admin_user)
    response = await ac.get("/discord/available-guilds")
    assert response.status_code == 200
    assert response.json()[0]["id"] == "guild-1"


async def test_guild_channels_unknown_guild_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get("/discord/guilds/nonexistent/channels")
    assert response.status_code == 404


async def test_guild_channels_and_roles_returned(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    await _seed_guild_inventory()
    ac = authed_client_factory(admin_user)
    channels_resp = await ac.get("/discord/guilds/guild-1/channels")
    assert channels_resp.status_code == 200
    assert channels_resp.json()[0]["id"] == "chan-1"

    roles_resp = await ac.get("/discord/guilds/guild-1/roles")
    assert roles_resp.status_code == 200
    assert roles_resp.json()[0]["id"] == "role-1"


# ── role-policies ─────────────────────────────────────────────────────────────


async def test_create_role_policy_unknown_role_returns_422(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    await _seed_guild_inventory()
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/discord/role-policies",
        json={"guild_id": "guild-1", "role_id": "not-a-real-role"},
    )
    assert response.status_code == 422


async def test_create_update_delete_role_policy(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    await _seed_guild_inventory()
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/discord/role-policies", json={"guild_id": "guild-1", "role_id": "role-1"}
    )
    assert create_resp.status_code == 201
    policy_id = create_resp.json()["id"]
    assert create_resp.json()["role_name"] == "幹部"

    list_resp = await ac.get("/discord/role-policies")
    assert any(row["id"] == policy_id for row in list_resp.json())

    update_resp = await ac.patch(
        f"/discord/role-policies/{policy_id}",
        json={"guild_id": "guild-1", "role_id": "role-1", "priority": 5},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["priority"] == 5

    delete_resp = await ac.delete(f"/discord/role-policies/{policy_id}")
    assert delete_resp.status_code == 204


async def test_create_role_policy_position_org_mismatch_422(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    await _seed_guild_inventory()
    org_a = Org(name=f"org-a-{uuid.uuid4().hex[:6]}")
    org_b = Org(name=f"org-b-{uuid.uuid4().hex[:6]}")
    db_session.add_all([org_a, org_b])
    await db_session.flush()
    position = Position(org_id=org_a.id, name="幹部")
    db_session.add(position)
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/discord/role-policies",
        json={
            "guild_id": "guild-1",
            "role_id": "role-1",
            "position_id": str(position.id),
            "org_id": str(org_b.id),
        },
    )
    assert response.status_code == 422


# ── member-sync-states ────────────────────────────────────────────────────────


async def test_list_member_sync_states_requires_admin_all(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/discord/member-sync-states")
    assert response.status_code == 403


async def test_repair_member_sync_state_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post(f"/discord/member-sync-states/{uuid.uuid4()}/repair")
    assert response.status_code == 404


async def test_repair_member_sync_states_batch(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., User],
    db_session: AsyncSession,
) -> None:
    from api.models.discord_account import DiscordMemberSyncState

    target = await make_user(email="discord-drift-user@school.edu")
    state = DiscordMemberSyncState(
        id=uuid.uuid4(),
        guild_id="guild-1",
        discord_user_id="d-drift",
        user_id=target.id,
        has_role_drift=True,
        actual_role_ids=[],
        desired_role_ids=["role-1"],
    )
    db_session.add(state)
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    response = await ac.post("/discord/member-sync-states/repair", json={"drift_only": True})
    assert response.status_code == 200
    assert response.json()["queued"] == 1


# ── role-mappings / org-channel-mappings / nickname-prefix-rules ──────────────


async def test_create_update_delete_role_mapping(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = Org(name=f"org-rm-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/discord/role-mappings",
        json={
            "guild_id": "guild-1",
            "role_id": "role-1",
            "mapping_kind": "org",
            "org_id": str(org.id),
        },
    )
    assert create_resp.status_code == 201
    mapping_id = create_resp.json()["id"]

    update_resp = await ac.patch(
        f"/discord/role-mappings/{mapping_id}",
        json={
            "guild_id": "guild-1",
            "role_id": "role-2",
            "mapping_kind": "org",
            "org_id": str(org.id),
        },
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["role_id"] == "role-2"

    delete_resp = await ac.delete(f"/discord/role-mappings/{mapping_id}")
    assert delete_resp.status_code == 204


async def test_create_role_mapping_missing_target_returns_422(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/discord/role-mappings",
        json={"guild_id": "guild-1", "role_id": "role-1", "mapping_kind": "org"},
    )
    assert response.status_code == 422


async def test_create_and_delete_org_channel_mapping(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = Org(name=f"org-cm-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/discord/org-channel-mappings",
        json={"guild_id": "guild-1", "org_id": str(org.id), "channel_id": "chan-1"},
    )
    assert create_resp.status_code == 201
    mapping_id = create_resp.json()["id"]

    list_resp = await ac.get("/discord/org-channel-mappings")
    assert any(row["id"] == mapping_id for row in list_resp.json())

    delete_resp = await ac.delete(f"/discord/org-channel-mappings/{mapping_id}")
    assert delete_resp.status_code == 204

    # 端點只檢查列是否存在（is_active 設為 False 是冪等操作），非「找不到已停用項目
    # 才 404」的語意，故第二次 DELETE 仍是 204。
    delete_again_resp = await ac.delete(f"/discord/org-channel-mappings/{mapping_id}")
    assert delete_again_resp.status_code == 204

    delete_missing_resp = await ac.delete(f"/discord/org-channel-mappings/{uuid.uuid4()}")
    assert delete_missing_resp.status_code == 404


async def test_create_update_delete_nickname_prefix_rule(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = Org(name=f"org-np-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/discord/nickname-prefix-rules",
        json={
            "guild_id": "guild-1",
            "prefix": "[幹部]",
            "mapping_kind": "org",
            "org_id": str(org.id),
        },
    )
    assert create_resp.status_code == 201
    rule_id = create_resp.json()["id"]

    update_resp = await ac.patch(
        f"/discord/nickname-prefix-rules/{rule_id}",
        json={
            "guild_id": "guild-1",
            "prefix": "[幹部2]",
            "mapping_kind": "org",
            "org_id": str(org.id),
        },
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["prefix"] == "[幹部2]"

    delete_resp = await ac.delete(f"/discord/nickname-prefix-rules/{rule_id}")
    assert delete_resp.status_code == 204
