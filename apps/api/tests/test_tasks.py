from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.document import ApprovalStepStatus, Document, DocumentApproval, DocumentStatus
from api.models.org import Org
from api.models.survey import Survey, SurveyResponse, SurveyStatus
from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def _seed_user(db: AsyncSession) -> User:
    user = User(
        email="tasks-user@school.edu",
        display_name="待辦測試",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def test_tasks_and_count_return_consistent_totals(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = await _seed_user(db_session)
    db_session.add(
        WorkItem(
            title="確認公告稿",
            status=WorkItemStatus.OPEN,
            assigned_to_id=user.id,
            source_type="work_item",
            source_id=None,
            is_active=True,
        )
    )
    await db_session.flush()
    _override_user(user)

    inbox_response = await client.get("/tasks")
    count_response = await client.get("/tasks/count")

    assert inbox_response.status_code == 200
    assert count_response.status_code == 200
    inbox = inbox_response.json()
    counts = count_response.json()
    assert inbox["total"] == 1
    assert counts == {
        "total": 1,
        "by_module": {"work_item": 1},
        "urgent_count": 0,
    }
    assert inbox["items"][0]["href"] == "/tasks"


async def test_task_count_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/tasks/count")

    assert response.status_code == 401


async def test_tasks_exclude_pending_document_for_user_without_approve_permission(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = await _seed_user(db_session)
    creator = User(
        email="tasks-document-creator@school.edu",
        display_name="公文建立者",
        is_active=True,
        is_verified=True,
    )
    org = Org(name="待辦測試組織")
    db_session.add_all([creator, org])
    await db_session.flush()
    document = Document(
        serial_number="DOC-2026-TASKS-001",
        title="不應顯示的待審公文",
        org_id=org.id,
        created_by=creator.id,
        status=DocumentStatus.PENDING,
        current_step=1,
    )
    db_session.add(document)
    await db_session.flush()
    db_session.add(
        DocumentApproval(
            document_id=document.id,
            approver_id=user.id,
            step_order=1,
            status=ApprovalStepStatus.PENDING,
        )
    )
    await db_session.flush()
    _override_user(user)

    response = await client.get("/tasks")

    assert response.status_code == 200
    assert response.json()["items"] == []

    stats_response = await client.get("/documents/stats")

    assert stats_response.status_code == 200
    assert stats_response.json()["pending_my_approval"] == 0


async def test_tasks_exclude_completed_non_repeatable_survey(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = await _seed_user(db_session)
    org = Org(name="待辦問卷組織")
    db_session.add(org)
    await db_session.flush()
    completed = Survey(
        title="已填問卷",
        org_id=org.id,
        created_by=user.id,
        status=SurveyStatus.OPEN,
    )
    pending = Survey(
        title="未填問卷",
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

    inbox_response = await client.get("/tasks")
    count_response = await client.get("/tasks/count")

    assert inbox_response.status_code == 200
    assert [item["title"] for item in inbox_response.json()["items"]] == ["填答：未填問卷"]
    assert count_response.status_code == 200
    assert count_response.json()["by_module"] == {"survey": 1}
