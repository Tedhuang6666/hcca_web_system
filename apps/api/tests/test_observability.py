from __future__ import annotations

from httpx import AsyncClient

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


async def test_metrics_endpoint_is_enabled(client: AsyncClient) -> None:
    response = await client.get("/metrics")

    assert response.status_code == 200
    assert "hcca_http_requests_total" in response.text
