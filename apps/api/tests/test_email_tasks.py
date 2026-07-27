"""預約寄送背景任務測試（apps/api/src/api/services/email_tasks.py）。"""

from __future__ import annotations

import json
from unittest.mock import patch

from api.core.config import settings
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
    from api.services.error_report_tasks import ErrorEventBatch, _run

    with (
        patch("api.services.error_report_tasks.settings.ERROR_REPORT_EMAIL_ENABLED", True),
        patch("api.services.error_report_tasks.settings.OWNER_EMAILS", ["owner@example.com"]),
        patch("api.services.error_report_tasks.settings.RESEND_API_KEY", "configured"),
        patch("api.services.error_report_tasks.feature_flag.is_enabled", return_value=False),
        patch("api.services.error_report_tasks.Redis.from_url"),
        patch("api.services.error_report_tasks._read_last_sent", return_value=0),
        patch(
            "api.services.error_report_tasks._read_new_error_events",
            return_value=ErrorEventBatch(events=[{"occurred_at": 1}]),
        ),
        patch(
            "api.services.error_report_tasks._read_recent_dlq",
            return_value=ErrorEventBatch(events=[]),
        ),
    ):
        result = await _run()

    assert result == {"ok": True, "skipped": "feature_flag_disabled"}


class _ErrorReportRedisStub:
    def __init__(self, items: list[dict[str, object]]) -> None:
        self.items = [json.dumps(item) for item in items]
        self.suppressed: dict[str, str] = {}

    def lrange(self, _key: str, _start: int, _stop: int) -> list[str]:
        return self.items

    def hgetall(self, _key: str) -> dict[str, str]:
        return self.suppressed.copy()

    def hset(self, _key: str, *, mapping: dict[str, str]) -> None:
        self.suppressed.update(mapping)

    def hdel(self, _key: str, *keys: str) -> None:
        for key in keys:
            self.suppressed.pop(key, None)

    def expire(self, _key: str, _seconds: int) -> None:
        return None


def _api_error(message: str, occurred_at: float) -> dict[str, object]:
    return {
        "occurred_at": occurred_at,
        "error_id": f"error-{occurred_at}",
        "request_id": f"request-{occurred_at}",
        "category": "http",
        "exc_type": "HTTPException",
        "message": message,
        "method": "GET",
        "path": "/calendar/google/calendars/org",
        "status_code": 502,
        "traceback_head": "traceback",
    }


def test_error_report_assigns_severity_and_filters_warnings() -> None:
    from api.services.error_report_tasks import (
        _meets_min_severity,
        _read_new_error_events,
        _severity_for_event,
    )

    warning = _api_error("HTTPException: 503: Discord OAuth 尚未設定", 900)
    redis_failure = _api_error("HTTPException: 503: 登入服務暫時不可用", 900)
    redis_failure["category"] = "redis"

    assert _severity_for_event(warning) == "warning"
    assert _severity_for_event(redis_failure) == "critical"
    with patch.object(settings, "ERROR_REPORT_MIN_SEVERITY", "error"):
        assert not _meets_min_severity(warning)
        assert _meets_min_severity(redis_failure)

        client = _ErrorReportRedisStub([warning])
        batch = _read_new_error_events(client, last_sent=0, now=1000)
        assert batch.events == []
        assert batch.filtered_occurrences == 1


def test_error_report_filters_expected_auth_failures_only() -> None:
    from api.services.error_report_tasks import _read_new_error_events

    expected_errors = [
        _api_error("HTTPException: 503: Discord OAuth 尚未設定", 900),
        _api_error("HTTPException: 503: 尚未設定 Google Client ID", 901),
        _api_error("HTTPException: 503: 登入服務暫時不可用，請稍後再試", 902),
    ]
    expected_errors[0]["path"] = "/auth/discord/login"
    expected_errors[0]["status_code"] = 503
    expected_errors[1]["path"] = "/auth/google/one-tap"
    expected_errors[1]["method"] = "POST"
    expected_errors[1]["status_code"] = 503
    expected_errors[2]["path"] = "/auth/refresh"
    expected_errors[2]["method"] = "POST"
    expected_errors[2]["status_code"] = 503
    unrelated_error = _api_error("HTTPException: 503: 登入服務暫時不可用，請稍後再試", 903)
    unrelated_error["path"] = "/documents"
    unrelated_error["status_code"] = 503

    with patch.object(settings, "ERROR_REPORT_MIN_SEVERITY", "warning"):
        batch = _read_new_error_events(
            _ErrorReportRedisStub([*expected_errors, unrelated_error]),
            last_sent=0,
            now=1800,
        )

    assert len(batch.events) == 1
    assert batch.events[0]["path"] == "/documents"
    assert batch.filtered_occurrences == 3


def test_error_report_aggregates_and_suppresses_repeated_events() -> None:
    from api.services.error_report_tasks import _mark_notified, _read_new_error_events

    client = _ErrorReportRedisStub(
        [
            _api_error("HTTPException: 502: network down", 1100),
            _api_error("HTTPException: 502: network down", 1101),
            _api_error("HTTPException: 502: network down", 1102),
        ]
    )
    with (
        patch.object(settings, "ERROR_REPORT_MIN_SEVERITY", "error"),
        patch.object(settings, "ERROR_REPORT_REPEAT_COOLDOWN_SECONDS", 3600),
    ):
        first = _read_new_error_events(client, last_sent=0, now=2000)
        assert len(first.events) == 1
        assert first.events[0]["occurrences"] == 3

        _mark_notified(client, [first.events[0]["signature"]], now=2000)
        client.items.append(json.dumps(_api_error("HTTPException: 502: network down", 2001)))
        second = _read_new_error_events(client, last_sent=1102, now=2001)

    assert second.events == []
    assert second.suppressed_occurrences == 1
