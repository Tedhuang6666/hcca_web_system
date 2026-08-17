from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.prometheus_metrics import (
    init_metrics,
    record_backup_run,
    record_celery_task,
    record_document_approval,
    record_email_delivery,
    record_outbox_delivery,
    record_webhook_delivery,
    render_metrics,
    set_websocket_connections,
)
from api.core.sentry import _before_send
from api.core.structured_logging import reset_request_id, set_request_id
from api.models.observability import PageSpeedRun
from api.services.observability import _merge_rum_urls


def test_business_metrics_are_exported() -> None:
    init_metrics()
    record_celery_task("tests.example", "success")
    record_document_approval("approved")
    record_email_delivery("sent")
    record_webhook_delivery("document.approved", "success")
    record_outbox_delivery("document.approved", "processed")
    record_backup_run("database", "success")
    set_websocket_connections(3)

    payload = render_metrics().decode()

    assert 'hcca_celery_tasks_total{status="success",task="tests.example"}' in payload
    assert 'hcca_document_approval_total{status="approved"}' in payload
    assert 'hcca_email_delivery_total{status="sent"}' in payload
    assert 'hcca_webhook_delivery_total{event_type="document.approved",status="success"}' in payload
    assert (
        'hcca_outbox_delivery_total{event_type="document.approved",status="processed"}' in payload
    )
    assert 'hcca_backup_runs_total{kind="database",status="success"}' in payload
    assert 'hcca_backup_last_success_timestamp_seconds{kind="database"}' in payload
    assert "hcca_websocket_connections 3.0" in payload


def test_sentry_event_uses_structured_log_request_id() -> None:
    token = set_request_id("request-test-123")
    try:
        event = _before_send({"extra": {}, "tags": {}}, {})
    finally:
        reset_request_id(token)

    assert event is not None
    assert event["tags"]["request_id"] == "request-test-123"
    assert event["extra"]["request_id"] == "request-test-123"


def test_rum_api_metrics_are_not_page_speed_targets(monkeypatch) -> None:
    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", "https://hcca.tw")

    urls = _merge_rum_urls(
        ["https://hcca.tw/"],
        {
            "routes": [
                {"path": "/auth/me", "pageviews": 0, "api_latency_p95_ms": 120},
                {"path": "/new-page", "pageviews": 1, "api_latency_p95_ms": None},
            ]
        },
    )

    assert urls == ["https://hcca.tw/", "https://hcca.tw/new-page"]


async def test_metrics_endpoint_is_enabled(client: AsyncClient) -> None:
    response = await client.get("/metrics")

    assert response.status_code == 200
    assert "hcca_http_requests_total" in response.text


async def test_authenticated_performance_channel_issues_short_lived_access_token(
    client: AsyncClient,
    admin_user,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "PERFORMANCE_MONITOR_TOKEN", "test-performance-token")
    monkeypatch.setattr(settings, "PERFORMANCE_MONITOR_USER_ID", str(admin_user.id))

    denied = await client.post(
        "/internal/observability/auth-session",
        headers={"X-Performance-Monitor-Token": "wrong"},
    )
    assert denied.status_code == 404

    response = await client.post(
        "/internal/observability/auth-session",
        headers={"X-Performance-Monitor-Token": "test-performance-token"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["cookie_name"] == settings.ACCESS_TOKEN_COOKIE_NAME
    assert payload["expires_in_seconds"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    assert payload["access_token"]


async def test_authenticated_performance_results_are_recorded_for_both_strategies(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "PERFORMANCE_MONITOR_TOKEN", "test-performance-token")
    monkeypatch.setattr(settings, "FRONTEND_BASE_URL", "http://test")
    response = await client.post(
        "/internal/observability/authenticated-runs",
        headers={"X-Performance-Monitor-Token": "test-performance-token"},
        json={
            "release": "test-release",
            "runs": [
                {
                    "url": "http://test/merchandise-submissions",
                    "strategy": "mobile",
                    "performance_score": 96,
                },
                {
                    "url": "http://test/merchandise-submissions",
                    "strategy": "desktop",
                    "performance_score": 99,
                },
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["created"] == 2
    rows = (await db_session.scalars(select(PageSpeedRun))).all()
    assert {row.strategy for row in rows} == {"auth-mobile", "auth-desktop"}
