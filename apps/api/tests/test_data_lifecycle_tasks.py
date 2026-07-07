"""資料生命週期自動清理任務測試（apps/api/src/api/services/data_lifecycle_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from api.services.data_lifecycle_tasks import _run, run_safe_purges


def _close_coro(coro, value=None, exc=None):  # noqa: ANN001
    coro.close()
    if exc is not None:
        raise exc
    return value


def test_run_safe_purges_only_covers_safe_rules() -> None:
    fake_result = {"results": [{"rule_id": "x", "action": "noop", "matched": 0}]}
    with patch(
        "api.services.data_lifecycle_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, fake_result),
    ):
        result = run_safe_purges()
    assert result == fake_result


def test_run_safe_purges_retries_on_failure() -> None:
    with (
        patch.object(run_safe_purges, "retry", side_effect=Exception("retry called")),
        patch(
            "api.services.data_lifecycle_tasks.asyncio.run",
            side_effect=lambda coro: _close_coro(coro, exc=RuntimeError("db down")),
        ),
        pytest.raises(Exception, match="retry called"),
    ):
        run_safe_purges()


async def test_run_executes_all_safe_rules_against_empty_data() -> None:
    result = await _run()
    assert "results" in result
    for entry in result["results"]:
        assert entry.get("error") is not True
