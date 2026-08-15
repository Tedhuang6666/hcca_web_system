from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.user import User


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def test_dashboard_composite_returns_all_requested_sections(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = User(
        email="dashboard-user@school.edu",
        display_name="儀表板測試",
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    _override_user(user)

    response = await client.get("/dashboard/composite")

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"dashboard", "tasks", "matters", "announcements"}
    assert payload["dashboard"]["layout_hint"] == "student"
    assert payload["tasks"]["total"] == 0
    assert payload["matters"] == []
    assert payload["announcements"] == []


async def test_dashboard_composite_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/dashboard/composite")

    assert response.status_code == 401
