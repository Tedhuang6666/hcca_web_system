"""模組自動恢復排程任務測試（apps/api/src/api/services/recovery_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

import pytest_asyncio

from api.services.recovery_tasks import process_half_open_probes


@pytest_asyncio.fixture(autouse=True)
async def _clear_module_probe_queue() -> None:
    # module_probe_queue 是跨 test run 不會被清空的 Redis ZSET（不像 Postgres
    # schema 每個 worker 重建）；並行 session 或前次未清乾淨的探測都會殘留，
    # 讓「無到期探測」的假設失真。每個測試前先清空。
    from api.core.module_recovery import _PROBE_QUEUE_KEY
    from api.core.security import redis_client

    await redis_client.delete(_PROBE_QUEUE_KEY)


def test_process_half_open_probes_no_due_probes_returns_empty() -> None:
    result = process_half_open_probes()
    assert result == {"probed": 0, "recovered": [], "still_down": []}


def _close_coro_and_raise(coro):  # noqa: ANN001
    coro.close()
    raise RuntimeError("boom")


def test_process_half_open_probes_swallows_exceptions() -> None:
    with patch("api.services.recovery_tasks.asyncio.run", side_effect=_close_coro_and_raise):
        result = process_half_open_probes()
    assert result == {"probed": 0, "recovered": [], "still_down": []}
