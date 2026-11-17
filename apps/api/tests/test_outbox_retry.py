"""Outbox：資料庫錯誤也要計入重試次數，不能無限重試。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError

from api.core.database import task_session
from api.models.outbox import OutboxEvent, OutboxStatus
from api.services import outbox


async def test_database_error_during_dispatch_is_counted_and_releases_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = f"worker-{uuid.uuid4().hex[:6]}"
    async with task_session() as db:
        event = OutboxEvent(
            event_type="test.db_error",
            payload={"secret": "student-id-123"},
            status=OutboxStatus.PENDING,
            created_at=datetime.now(UTC),
            locked_by=owner,
            locked_until=datetime.now(UTC),
        )
        db.add(event)
        await db.commit()
        event_id = event.id

    async def failing_dispatch(db, event):  # noqa: ANN001
        raise OperationalError("UPDATE x SET y=%(v)s", {"v": "student-id-123"}, Exception("boom"))

    monkeypatch.setattr(outbox, "_dispatch", failing_dispatch)
    try:
        await outbox._process_claimed_event(event_id, owner)

        async with task_session() as db:
            stored = await db.scalar(select(OutboxEvent).where(OutboxEvent.id == event_id))
            assert stored is not None
            assert stored.retry_count == 1
            assert stored.status == OutboxStatus.PENDING
            assert stored.locked_by is None
            assert stored.next_attempt_at is not None
            assert stored.last_error == "OperationalError"
    finally:
        async with task_session() as db:
            await db.execute(delete(OutboxEvent).where(OutboxEvent.id == event_id))
            await db.commit()
