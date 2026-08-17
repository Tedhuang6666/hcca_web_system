from __future__ import annotations

import time

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from api.core.config import settings
from api.core.prometheus_metrics import (
    _route_template,
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
from api.services.observability import (
    _merge_rum_urls,
    client_route_analytics,
    record_client_metrics,
)


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
    assert "hcca_build_info" in payload


def test_sentry_event_uses_structured_log_request_id() -> None:
    token = set_request_id("request-test-123")
    try:
        event = _before_send({"extra": {}, "tags": {}}, {})
    finally:
        reset_request_id(token)

    assert event is not None
    assert event["tags"]["request_id"] == "request-test-123"
    assert event["extra"]["request_id"] == "request-test-123"


def test_unmatched_prometheus_paths_use_bounded_label() -> None:
    request = Request({"type": "http", "path": "/random-user-supplied-path"})

    assert _route_template(request) == "/__unmatched__"


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


async def test_client_route_analytics_aggregates_all_field_metric_families(monkeypatch) -> None:
    class FakeRedis:
        async def lrange(self, *_args):
            import json

            return [
                json.dumps(
                    {
                        "metric": "page_view",
                        "value": 1,
                        "path": "/dashboard",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "client_error",
                        "value": 1,
                        "path": "/dashboard",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "longtask",
                        "value": 180,
                        "path": "/dashboard",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "navigation_ttfb",
                        "value": 90,
                        "path": "/dashboard",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "resource_timing",
                        "value": 240,
                        "path": "/dashboard",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "custom_action",
                        "value": 320,
                        "path": "/dashboard",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "lcp",
                        "value": 1_200,
                        "path": "/dashboard",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "lcp",
                        "value": 4_000,
                        "path": "/dashboard",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "api_latency",
                        "value": 100,
                        "path": "/dashboard",
                        "status": 200,
                        "operation_kind": "simple_get",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "api_latency",
                        "value": 1_000,
                        "path": "/dashboard",
                        "status": 503,
                        "operation_kind": "simple_get",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
                json.dumps(
                    {
                        "metric": "api_latency",
                        "value": 0,
                        "path": "/dashboard",
                        "status": 0,
                        "operation_kind": "simple_get",
                        "device_class": "mobile",
                        "auth_state": "authenticated",
                        "release": "web@test",
                        "ts": time.time(),
                    }
                ),
            ]

    async def no_cache_get(_key):
        return None

    async def no_cache_set(*_args, **_kwargs):
        return None

    monkeypatch.setattr("api.services.observability.redis_client", FakeRedis())
    monkeypatch.setattr("api.services.observability.cache_get", no_cache_get)
    monkeypatch.setattr("api.services.observability.cache_set", no_cache_set)

    result = await client_route_analytics(window_hours=1)
    route = result["routes"][0]

    assert route["device_class"] == "mobile"
    assert route["auth_state"] == "authenticated"
    assert route["release"] == "web@test"
    assert route["pageviews"] == 1
    assert route["client_errors"] == 1
    assert route["api_errors"] == 1
    assert route["api_timeouts"] == 1
    assert route["web_vitals"]["lcp_p50"] == 1200.0
    assert route["web_vitals"]["lcp_p99"] == 4000.0
    assert route["api_latency_percentiles_ms"]["p50_ms"] == 100.0
    assert route["longtask_p75_ms"] == 180.0
    assert route["navigation_ttfb_p75_ms"] == 90.0
    assert route["resource_timing_p75_ms"] == 240.0
    assert route["custom_metrics"]["custom_action"]["p75_ms"] == 320.0


async def test_record_client_metrics_pushes_a_batch_with_one_redis_write(monkeypatch) -> None:
    class FakePipeline:
        def __init__(self) -> None:
            self.commands: list[tuple] = []

        def lpush(self, *args):
            self.commands.append(("lpush", *args))
            return self

        def ltrim(self, *args):
            self.commands.append(("ltrim", *args))
            return self

        def expire(self, *args):
            self.commands.append(("expire", *args))
            return self

        async def execute(self):
            return []

    class FakeRedis:
        def __init__(self) -> None:
            self.pipeline_instance = FakePipeline()

        def pipeline(self, **_kwargs):
            return self.pipeline_instance

    redis = FakeRedis()
    monkeypatch.setattr("api.services.observability.redis_client", redis)

    assert await record_client_metrics(
        [
            {"metric": "fcp", "value": 120},
            {"metric": "lcp", "value": 480},
        ]
    )

    commands = redis.pipeline_instance.commands
    assert commands[0][0] == "lpush"
    assert commands[0][1] == "observability:client-telemetry:v1"
    assert len(commands[0][2:]) == 2
    assert commands[1][0] == "ltrim"
    assert commands[2][0] == "expire"


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
