"""工作分配期限提醒任務測試（apps/api/src/api/services/work_item_tasks.py）。"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus
from api.services.work_item import remind_due_work_items
from api.services.work_item_tasks import remind_due_work_items_task


def _close_coro(coro, value):  # noqa: ANN001
    coro.close()
    return value


def test_remind_due_work_items_task_returns_asyncio_run_result() -> None:
    with patch(
        "api.services.work_item_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, 3),
    ) as mock_run:
        result = remind_due_work_items_task()
    mock_run.assert_called_once()
    assert result == 3


async def test_remind_due_work_items_flags_due_soon_and_skips_others(
    db_session: AsyncSession, make_user: Callable[..., User]
) -> None:
    assignee = await make_user(email="work-item-due-assignee@school.edu")
    now = datetime.now(UTC)

    due_soon = WorkItem(
        id=uuid.uuid4(),
        title="快到期任務",
        status=WorkItemStatus.OPEN,
        assigned_to_id=assignee.id,
        due_at=now + timedelta(hours=1),
    )
    not_due = WorkItem(
        id=uuid.uuid4(),
        title="還早的任務",
        status=WorkItemStatus.OPEN,
        assigned_to_id=assignee.id,
        due_at=now + timedelta(days=10),
    )
    unassigned = WorkItem(
        id=uuid.uuid4(),
        title="未指派任務",
        status=WorkItemStatus.OPEN,
        due_at=now + timedelta(hours=1),
    )
    db_session.add_all([due_soon, not_due, unassigned])
    await db_session.flush()

    count = await remind_due_work_items(db_session)

    assert count == 1
    await db_session.refresh(due_soon)
    await db_session.refresh(not_due)
    assert due_soon.reminder_sent_at is not None
    assert not_due.reminder_sent_at is None


async def test_remind_due_work_items_no_due_items_returns_zero(db_session: AsyncSession) -> None:
    count = await remind_due_work_items(db_session)
    assert count == 0
