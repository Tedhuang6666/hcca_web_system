"""Outbox 背景任務測試（apps/api/src/api/services/outbox_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

from api.services.outbox_tasks import process_outbox


def test_process_outbox_task_calls_process_pending_outbox() -> None:
    with patch("api.services.outbox.process_pending_outbox") as mock_process:
        result = process_outbox()
    mock_process.assert_called_once()
    assert result == {"status": "ok"}
