from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.discord_account import DiscordAccountLink
from api.models.user import User
from api.services.discord_bot import get_user_by_discord_id


async def test_discord_login_without_oauth_config_returns_503(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "DISCORD_CLIENT_ID", "")
    monkeypatch.setattr(settings, "DISCORD_CLIENT_SECRET", "")

    response = await client.get("/auth/discord/login", follow_redirects=False)

    assert response.status_code == 503


async def test_discord_login_resolves_only_active_binding(db_session: AsyncSession) -> None:
    user = User(
        email="discord-login@hchs.hc.edu.tw",
        display_name="Discord Login",
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()

    link = DiscordAccountLink(
        user_id=user.id,
        discord_user_id="123456789012345678",
        is_active=True,
    )
    db_session.add(link)
    await db_session.flush()

    assert await get_user_by_discord_id(db_session, link.discord_user_id) == user

    link.is_active = False
    await db_session.flush()

    assert await get_user_by_discord_id(db_session, link.discord_user_id) is None
