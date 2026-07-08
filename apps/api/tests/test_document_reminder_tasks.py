"""公文自動催辦背景任務測試（apps/api/src/api/services/document_reminder_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

import pytest

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


async def test_process_overdue_async_returns_structured_result() -> None:
    result = await _process_overdue_async()
    assert result["status"] == "ok"
    assert set(result.keys()) >= {
        "examined",
        "reminders_sent",
        "escalated",
        "admin_escalated",
    }
