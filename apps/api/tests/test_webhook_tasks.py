"""Webhook 投遞背景任務測試（apps/api/src/api/services/webhook_tasks.py）。"""

from __future__ import annotations

import uuid

from api.services.webhook_tasks import _deliver_one_async, _process_due_async


async def test_deliver_one_async_skips_when_delivery_missing() -> None:
    result = await _deliver_one_async(str(uuid.uuid4()))
    assert result == {"status": "skipped", "reason": "delivery not found"}


async def test_process_due_async_returns_dispatch_count() -> None:
    result = await _process_due_async(batch_size=10)
    assert result["status"] == "ok"
    assert result["dispatched"] >= 0
