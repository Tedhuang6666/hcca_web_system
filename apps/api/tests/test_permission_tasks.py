"""過期任期權限快取清除任務測試（apps/api/src/api/services/permission_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

from api.services.permission_tasks import _invalidate_async, invalidate_expired_user_caches


def _close_coro(coro, value):  # noqa: ANN001
    coro.close()
    return value


def test_invalidate_expired_user_caches_task_returns_asyncio_run_result() -> None:
    with patch(
        "api.services.permission_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, {"invalidated": 2}),
    ) as mock_run:
        result = invalidate_expired_user_caches()
    mock_run.assert_called_once()
    assert result == {"invalidated": 2}


async def test_invalidate_async_no_expired_positions_returns_zero() -> None:
    result = await _invalidate_async()
    assert result == {"invalidated": 0}
