"""商品系統班級結單通知／劃位保留鎖清理背景任務測試（apps/api/src/api/services/shop_tasks.py）。

兩個 task 的核心邏輯都是巢狀函式（定義在各自 task 內、自建 task_session()），
無法單獨 import；只透過 mock asyncio.run 驗證 wrapper 層回傳形狀與 retry 行為。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from api.services.shop_tasks import cleanup_expired_seat_holds, notify_class_cadres_on_deadline


def _close_coro(coro, value=None, exc=None):  # noqa: ANN001
    coro.close()
    if exc is not None:
        raise exc
    return value


def test_notify_class_cadres_on_deadline_returns_notified_count() -> None:
    with patch(
        "api.services.shop_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, 4),
    ):
        result = notify_class_cadres_on_deadline()
    assert result == {"notified": 4}


def test_notify_class_cadres_on_deadline_retries_on_failure() -> None:
    with (
        patch.object(
            notify_class_cadres_on_deadline, "retry", side_effect=Exception("retry called")
        ),
        patch(
            "api.services.shop_tasks.asyncio.run",
            side_effect=lambda coro: _close_coro(coro, exc=RuntimeError("db down")),
        ),
        pytest.raises(Exception, match="retry called"),
    ):
        notify_class_cadres_on_deadline()


def test_cleanup_expired_seat_holds_returns_removed_count() -> None:
    with patch(
        "api.services.shop_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, 7),
    ):
        result = cleanup_expired_seat_holds()
    assert result == {"removed": 7}


def test_cleanup_expired_seat_holds_retries_on_failure() -> None:
    with (
        patch.object(cleanup_expired_seat_holds, "retry", side_effect=Exception("retry called")),
        patch(
            "api.services.shop_tasks.asyncio.run",
            side_effect=lambda coro: _close_coro(coro, exc=RuntimeError("db down")),
        ),
        pytest.raises(Exception, match="retry called"),
    ):
        cleanup_expired_seat_holds()
