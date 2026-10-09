"""Outbox 背景任務測試（apps/api/src/api/services/outbox_tasks.py）。"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from api.email.generic import render_generic_message
from api.models.outbox import OutboxEvent
from api.services.outbox import _dispatch, _handle_shop_order_confirmed
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


def test_shop_order_confirmation_preserves_item_line_breaks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, str] = {}

    def fake_enqueue_email(*args: object, **kwargs: object) -> None:
        captured["subject"] = str(args[1])
        captured["body"] = str(args[2])

    monkeypatch.setattr("api.services.mail.enqueue_email", fake_enqueue_email)
    _handle_shop_order_confirmed(
        {
            "buyer_email": "buyer@example.com",
            "buyer_name": "測試同學",
            "serial_number": "ORD-2026-000005",
            "subtotal_price": 802,
            "discount_amount": 20,
            "total_price": 782,
            "items": [
                {
                    "product_name": "奶油餅乾禮盒",
                    "unit_price": 401,
                    "quantity": 2,
                    "subtotal": 802,
                    "selected_options": [{"value": "大盒"}],
                }
            ],
        }
    )

    rendered = render_generic_message(
        captured["subject"], captured["body"], {"body_format": "html"}
    )

    assert "奶油餅乾禮盒</strong><br>單價：NT$ 401<br>數量：2<br>小計：NT$ 802" in rendered
    assert "規格：大盒</p>" in rendered
    assert "商品小計：NT$ 802<br>優惠折抵：− NT$ 20<br>" in rendered
    assert "應付總額：NT$ 782" in rendered
