"""會議開始提醒背景任務測試（apps/api/src/api/services/meeting_tasks.py）。

_run() 是巢狀函式（定義在 send_meeting_start_reminders 內、自建 task_session()），
無法單獨 import 直接測試內部邏輯；只透過 mock asyncio.run 驗證 wrapper 層的
回傳形狀與 retry 行為。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from api.services.meeting_tasks import send_meeting_start_reminders


def _close_coro(coro, value=None, exc=None):  # noqa: ANN001
    coro.close()
    if exc is not None:
        raise exc
    return value


def test_send_meeting_start_reminders_returns_count() -> None:
    with patch(
        "api.services.meeting_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, 2),
    ):
        result = send_meeting_start_reminders()
    assert result == {"reminded": 2}


def test_send_meeting_start_reminders_retries_on_failure() -> None:
    with (
        patch.object(send_meeting_start_reminders, "retry", side_effect=Exception("retry called")),
        patch(
            "api.services.meeting_tasks.asyncio.run",
            side_effect=lambda coro: _close_coro(coro, exc=RuntimeError("db down")),
        ),
        pytest.raises(Exception, match="retry called"),
    ):
        send_meeting_start_reminders()
