"""預約寄送背景任務測試（apps/api/src/api/services/email_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

from api.services.email_tasks import process_scheduled_emails


def _close_coro(coro, value):  # noqa: ANN001
    coro.close()
    return value


def test_process_scheduled_emails_returns_dispatch_result() -> None:
    fake_result = {"status": "ok", "dispatched": 2}
    with patch(
        "api.services.email_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, fake_result),
    ) as mock_run:
        result = process_scheduled_emails()
    mock_run.assert_called_once()
    assert result == fake_result


async def test_dispatch_scheduled_no_due_emails_returns_zero() -> None:
    from api.services.email_tasks import _dispatch_scheduled

    result = await _dispatch_scheduled()
    assert result["status"] == "ok"
    assert result["dispatched"] >= 0
