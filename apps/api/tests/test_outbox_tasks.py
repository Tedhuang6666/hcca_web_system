"""Outbox 背景任務測試（apps/api/src/api/services/outbox_tasks.py）。"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from api.models.outbox import OutboxEvent
from api.services.outbox import _dispatch
from api.services.outbox_tasks import process_outbox


def test_process_outbox_task_calls_process_pending_outbox() -> None:
    with patch(
        "api.services.outbox.process_pending_outbox",
        new_callable=AsyncMock,
    ) as mock_process:
        result = process_outbox()
    mock_process.assert_awaited_once()
    assert result == {"status": "ok"}


@pytest.mark.asyncio
async def test_dispatch_email_passes_attachments_to_mail_queue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_enqueue_email(*args: object, **kwargs: object) -> None:
        captured["args"] = args
        captured["kwargs"] = kwargs

    monkeypatch.setattr("api.services.mail.enqueue_email", fake_enqueue_email)
    event = OutboxEvent(
        event_type="email.send",
        payload={
            "to": ["recipient@example.com"],
            "subject": "公文通知",
            "body": "內容",
            "subtype": "html",
            "attachments": [{"filename": "公文.pdf", "content": "JVBERi0="}],
        },
    )

    await _dispatch(None, event)  # type: ignore[arg-type]

    assert captured["args"] == (
        ["recipient@example.com"],
        "公文通知",
        "內容",
        "html",
    )
    assert captured["kwargs"] == {"attachments": [{"filename": "公文.pdf", "content": "JVBERi0="}]}
