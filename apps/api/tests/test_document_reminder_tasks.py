"""公文自動催辦背景任務測試（apps/api/src/api/services/document_reminder_tasks.py）。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import patch

import pytest

from api.core import database as database_core
from api.services.document_reminder_tasks import _process_overdue_async, send_document_reminders


def _close_coro(coro, value=None, exc=None):  # noqa: ANN001
    coro.close()
    if exc is not None:
        raise exc
    return value


def test_send_document_reminders_returns_result() -> None:
    fake_result = {"status": "ok", "examined": 5, "reminders_sent": 2}
    with patch(
        "api.services.document_reminder_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, fake_result),
    ):
        result = send_document_reminders()
    assert result == fake_result


def test_send_document_reminders_retries_on_failure() -> None:
    with (
        patch.object(send_document_reminders, "retry", side_effect=Exception("retry called")),
        patch(
            "api.services.document_reminder_tasks.asyncio.run",
            side_effect=lambda coro: _close_coro(coro, exc=RuntimeError("db down")),
        ),
        pytest.raises(Exception, match="retry called"),
    ):
        send_document_reminders()


async def test_process_overdue_async_returns_structured_result(db_session, monkeypatch) -> None:
    @asynccontextmanager
    async def use_test_session():
        yield db_session

    # 背景 task 的獨立 session 預設讀 public schema；測試資料在專屬 schema。
    # 使用同一個真實 PostgreSQL fixture，避免誤連未遷移的 public schema。
    monkeypatch.setattr(database_core, "task_session", use_test_session)
    result = await _process_overdue_async()
    assert result["status"] == "ok"
    assert set(result.keys()) >= {
        "examined",
        "reminders_sent",
        "escalated",
        "admin_escalated",
    }
