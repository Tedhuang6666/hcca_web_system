"""物品借用逾期掃描／催還信背景任務測試（apps/api/src/api/services/loan_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

from api.services.loan_tasks import (
    _scan_overdue_async,
    _send_reminders_async,
    scan_overdue_loans,
    send_loan_reminders,
)


def _close_coro(coro, value):  # noqa: ANN001
    coro.close()
    return value


def test_scan_overdue_loans_returns_updated_count() -> None:
    with patch(
        "api.services.loan_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, {"updated": 5}),
    ) as mock_run:
        result = scan_overdue_loans()
    mock_run.assert_called_once()
    assert result == {"updated": 5}


def test_send_loan_reminders_returns_sent_count() -> None:
    with patch(
        "api.services.loan_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, {"sent": 3}),
    ) as mock_run:
        result = send_loan_reminders()
    mock_run.assert_called_once()
    assert result == {"sent": 3}


async def test_scan_overdue_async_returns_structured_result() -> None:
    result = await _scan_overdue_async()
    assert set(result.keys()) == {"updated"}
    assert result["updated"] >= 0


async def test_send_reminders_async_returns_structured_result() -> None:
    result = await _send_reminders_async()
    assert set(result.keys()) == {"sent"}
    assert result["sent"] >= 0
