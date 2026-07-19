from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.governance import Matter
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
    matter = Matter(title="校慶籌辦", created_by_id=user.id)
    db_session.add(matter)
    await db_session.flush()
    db_session.add(
        WorkItem(
            title="確認公告稿",
            status=WorkItemStatus.OPEN,
            assigned_to_id=user.id,
            source_type="matter",
            source_id=matter.id,
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
    assert inbox["items"][0]["href"] == f"/governance/{matter.id}#tasks"


async def test_task_count_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/tasks/count")

    assert response.status_code == 401
