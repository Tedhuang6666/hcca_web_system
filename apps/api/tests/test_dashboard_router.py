from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.announcement import Announcement
from api.models.org import Org
from api.models.survey import Survey, SurveyResponse, SurveyStatus
from api.models.user import User


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def test_dashboard_composite_excludes_retired_systems(
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
    assert set(payload) == {"dashboard", "tasks", "announcements"}
    assert payload["dashboard"]["layout_hint"] == "student"
    assert payload["tasks"]["total"] == 0
    assert payload["announcements"] == []


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


async def test_dashboard_hides_surveys_outside_user_audience(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = User(
        email="dashboard-audience-user@school.edu",
        display_name="儀表板受眾測試",
        is_active=True,
        is_verified=True,
    )
    org = Org(name="儀表板受眾問卷組織")
    db_session.add_all([user, org])
    await db_session.flush()
    db_session.add_all(
        [
            Survey(
                title="儀表板不可見問卷",
                org_id=org.id,
                created_by=user.id,
                status=SurveyStatus.OPEN,
                allowed_org_ids_json=json.dumps([str(uuid.uuid4())]),
            ),
            Survey(
                title="儀表板可見問卷",
                org_id=org.id,
                created_by=user.id,
                status=SurveyStatus.OPEN,
            ),
        ]
    )
    await db_session.flush()
    _override_user(user)

    response = await client.get("/dashboard")

    assert response.status_code == 200
    widget = next(item for item in response.json()["widgets"] if item["key"] == "open_surveys")
    assert [item["title"] for item in widget["items"]] == ["儀表板可見問卷"]


async def test_dashboard_recent_announcements_hide_drafts_and_other_audiences(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    viewer = User(
        email="dashboard-ann-viewer@school.edu",
        display_name="公告檢視者",
        is_active=True,
        is_verified=True,
    )
    author = User(email="dashboard-ann-author@school.edu", display_name="公告作者")
    db_session.add_all([viewer, author])
    await db_session.flush()
    db_session.add_all(
        [
            Announcement(
                title="未發布公告",
                content={},
                author_id=author.id,
                audience_type="all",
                is_published=False,
            ),
            Announcement(
                title="其他成員公告",
                content={},
                author_id=author.id,
                audience_type="members",
                is_published=True,
            ),
            Announcement(
                title="可見公告",
                content={},
                author_id=author.id,
                audience_type="all",
                is_published=True,
            ),
        ]
    )
    await db_session.flush()
    _override_user(viewer)

    response = await client.get("/dashboard")

    assert response.status_code == 200
    widget = next(
        item for item in response.json()["widgets"] if item["key"] == "announcements_recent"
    )
    assert [item["title"] for item in widget["items"]] == ["可見公告"]
