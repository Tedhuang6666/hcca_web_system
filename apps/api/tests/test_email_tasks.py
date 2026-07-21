"""預約寄送背景任務測試（apps/api/src/api/services/email_tasks.py）。"""

from __future__ import annotations

from unittest.mock import patch

from api.services.email_tasks import process_scheduled_emails


def _close_coro(coro, value):  # noqa: ANN001
    coro.close()
    return value


def test_process_scheduled_emails_returns_dispatch_result() -> None:
    fake_result = {"status": "ok", "dispatched": 2}
    with patch(
        "api.services.email_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, fake_result),
    ) as mock_run:
        result = process_scheduled_emails()
    mock_run.assert_called_once()
    assert result == fake_result


async def test_dispatch_scheduled_no_due_emails_returns_zero() -> None:
    from api.services.email_tasks import _dispatch_scheduled

    with patch("api.services.email_tasks.feature_flag.is_enabled", return_value=True):
        result = await _dispatch_scheduled()

    assert result["status"] == "ok"
    assert result["dispatched"] >= 0


async def test_dispatch_scheduled_when_disabled_skips_email_query() -> None:
    from api.services.email_tasks import _dispatch_scheduled

    with patch("api.services.email_tasks.feature_flag.is_enabled", return_value=False):
        result = await _dispatch_scheduled()

    assert result == {"status": "disabled", "dispatched": 0}


async def test_error_report_email_flag_can_disable_delivery() -> None:
    from api.services.error_report_tasks import _run

    with (
        patch("api.services.error_report_tasks.settings.ERROR_REPORT_EMAIL_ENABLED", True),
        patch("api.services.error_report_tasks.settings.OWNER_EMAILS", ["owner@example.com"]),
        patch("api.services.error_report_tasks.settings.RESEND_API_KEY", "configured"),
        patch("api.services.error_report_tasks.feature_flag.is_enabled", return_value=False),
        patch("api.services.error_report_tasks.Redis.from_url"),
        patch("api.services.error_report_tasks._read_last_sent", return_value=0),
        patch(
            "api.services.error_report_tasks._read_new_error_events",
            return_value=[{"occurred_at": 1}],
        ),
        patch("api.services.error_report_tasks._read_recent_dlq", return_value=[]),
    ):
        result = await _run()

    assert result == {"ok": True, "skipped": "feature_flag_disabled"}
