"""Email 通知摘要背景任務測試（apps/api/src/api/services/digest_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

from api.models.notification import Notification
from api.models.user import User
from api.services.digest_tasks import _process_digest, _render_digest_html


def _close_coro(coro, value):  # noqa: ANN001
    coro.close()
    return value


def test_send_daily_digest_returns_result() -> None:
    from api.services.digest_tasks import send_daily_digest

    fake_result = {"sent": 3, "skipped": 1}
    with patch(
        "api.services.digest_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, fake_result),
    ):
        result = send_daily_digest()
    assert result == fake_result


def test_render_digest_html_escapes_and_lists_notifications() -> None:
    user = User(display_name="<script>alert(1)</script>", email="x@school.edu")
    notif = Notification(
        user_id=None,
        type="test",
        title="<b>公告</b>",
        body="內容",
        link="/announcements/1",
    )
    from datetime import UTC, datetime

    notif.created_at = datetime.now(UTC)

    html = _render_digest_html(user, [notif])

    # 只跳脫 "<"（防止產生新標籤）；">" 刻意不轉義，此為既有實作行為。
    assert "<script>" not in html
    assert "&lt;script>" in html
    assert "<b>公告" not in html
    assert "&lt;b>公告" in html
    assert "共有" not in html  # 未超過 50 則不顯示截斷提示


async def test_process_digest_no_subscribers_is_safe() -> None:
    result = await _process_digest("daily", window_hours=24)
    assert set(result.keys()) == {"sent", "skipped"}
    assert result["sent"] >= 0
    assert result["skipped"] >= 0
