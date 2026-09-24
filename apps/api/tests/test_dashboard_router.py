from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.org import Org
from api.models.survey import Survey, SurveyResponse, SurveyStatus
from api.models.user import User


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def test_dashboard_composite_excludes_matters_by_default(
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
    assert payload["matters"] is None
    assert payload["announcements"] == []


async def test_dashboard_composite_with_matters_requires_governance_permission(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = User(
        email="dashboard-no-governance@school.edu",
        display_name="儀表板測試",
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    _override_user(user)

    response = await client.get("/dashboard/composite?include_matters=true")

    assert response.status_code == 403


async def test_dashboard_composite_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/dashboard/composite")

    assert response.status_code == 401


async def test_dashboard_excludes_completed_non_repeatable_survey(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = User(
        email="dashboard-survey-user@school.edu",
        display_name="儀表板問卷測試",
        is_active=True,
        is_verified=True,
    )
    org = Org(name="儀表板問卷組織")
    db_session.add_all([user, org])
    await db_session.flush()
    completed = Survey(
        title="儀表板已填問卷",
        org_id=org.id,
        created_by=user.id,
        status=SurveyStatus.OPEN,
    )
    pending = Survey(
        title="儀表板未填問卷",
        org_id=org.id,
        created_by=user.id,
        status=SurveyStatus.OPEN,
    )
    db_session.add_all([completed, pending])
    await db_session.flush()
    db_session.add(
        SurveyResponse(
            survey_id=completed.id,
            respondent_id=user.id,
            submitted_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    _override_user(user)

    response = await client.get("/dashboard")

    assert response.status_code == 200
    survey_widget = next(
        widget for widget in response.json()["widgets"] if widget["key"] == "open_surveys"
    )
    assert [item["title"] for item in survey_widget["items"]] == ["儀表板未填問卷"]
