from __future__ import annotations

import json

import pytest
from httpx import AsyncClient

from api.core import error_audit, security


@pytest.fixture
def isolated_error_audit(monkeypatch: pytest.MonkeyPatch):
    async def persist(_payload: dict[str, object]) -> None:
        return None

    async def empty_lrange(*_args, **_kwargs) -> list[str]:
        return []

    async def delete(_key: str) -> int:
        return 1

    monkeypatch.setattr(error_audit, "_persist_error_event", persist)
    monkeypatch.setattr(security.redis_client, "lrange", empty_lrange)
    monkeypatch.setattr(security.redis_client, "delete", delete)
    yield error_audit
    with error_audit._lock:
        error_audit._samples.clear()
        error_audit._index.clear()


@pytest.mark.asyncio
async def test_record_error_keeps_traceback_sanitizes_and_aggregates(isolated_error_audit) -> None:
    await isolated_error_audit.clear_errors()

    try:
        raise RuntimeError("password=secret-value token=secret-token")
    except RuntimeError as exc:
        await isolated_error_audit.record_error(
            error_id="error-1",
            exc=exc,
            method="GET",
            path="/broken",
            status_code=500,
        )

    await isolated_error_audit.record_error(
        error_id="error-2",
        exc=RuntimeError("password=another-secret"),
        method="GET",
        path="/broken",
        status_code=500,
    )

    items = await isolated_error_audit.get_recent_errors()
    assert len(items) == 1
    assert items[0]["occurrences"] == 2
    assert "secret-value" not in str(items[0])
    assert "secret-token" not in str(items[0])
    assert "RuntimeError" in str(items[0]["traceback_head"])


async def test_record_client_error_is_not_classified_as_server_exception(
    isolated_error_audit,
) -> None:
    await isolated_error_audit.record_client_error(
        message="browser failure",
        stack="Error: browser failure",
        scope="window.error",
        path="/admin/system",
        context={"release": "web@abc123", "viewport": "390x844"},
    )

    items = await isolated_error_audit.get_recent_errors()
    assert len(items) == 1
    assert items[0]["category"] == "client"
    assert items[0]["status_code"] == 0
    assert items[0]["context"] == {"release": "web@abc123", "viewport": "390x844"}


async def test_recent_errors_normalize_legacy_client_events(
    isolated_error_audit,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def legacy_lrange(*_args, **_kwargs) -> list[str]:
        return [
            json.dumps(
                {
                    "signature": "unhandled:ClientError:CLIENT:/admin/system",
                    "error_id": "legacy-client-1",
                    "category": "unhandled",
                    "exc_type": "ClientError",
                    "method": "CLIENT",
                    "path": "/admin/system",
                    "status_code": 500,
                    "occurred_at": 1,
                }
            )
        ]

    monkeypatch.setattr(security.redis_client, "lrange", legacy_lrange)

    items = await isolated_error_audit.get_recent_errors()
    assert items[0]["category"] == "client"
    assert items[0]["status_code"] == 0


async def test_recent_errors_filters_legacy_http_noise(
    isolated_error_audit,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def legacy_lrange(*_args, **_kwargs) -> list[str]:
        return [
            json.dumps(
                {
                    "signature": "http:HTTPException:GET:/tasks/count",
                    "error_id": "legacy-auth-1",
                    "category": "http",
                    "exc_type": "HTTPException",
                    "method": "GET",
                    "path": "/tasks/count",
                    "status_code": 401,
                    "occurred_at": 2,
                }
            ),
            json.dumps(
                {
                    "signature": "http:HTTPException:GET:/broken",
                    "error_id": "real-server-1",
                    "category": "http",
                    "exc_type": "HTTPException",
                    "method": "GET",
                    "path": "/broken",
                    "status_code": 500,
                    "occurred_at": 1,
                }
            ),
        ]

    monkeypatch.setattr(security.redis_client, "lrange", legacy_lrange)

    items = await isolated_error_audit.get_recent_errors()

    assert [item["error_id"] for item in items] == ["real-server-1"]


async def test_client_error_endpoint_is_anonymous_and_returns_error_id(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: dict[str, object] = {}

    async def record(**_kwargs) -> str:
        return "client-error-1"

    async def persist(**kwargs) -> None:
        received.update(kwargs)

    from api.routers import admin_system

    monkeypatch.setattr(admin_system, "record_client_error", record)
    monkeypatch.setattr(admin_system, "persist_client_error_incident", persist)
    response = await client.post(
        "/system/client-errors",
        json={
            "scope": "window.error",
            "message": "Something broke",
            "stack": "Error: Something broke",
            "pathname": "/documents?token=should-not-be-retained#section",
            "context": {
                "release": "web@abc123",
                "viewport": "390x844",
                "online": True,
                "page_origin": "https://hcca.tw",
                "api_origin": "https://api.hcca.tw",
                "diagnostics": {
                    "failure_kind": "timeout",
                    "request_method": "GET",
                    "request_path": "/shop/products/123?token=do-not-retain",
                    "request_attempts": 2,
                    "request_timeout_ms": 15_000,
                    "request_elapsed_ms": 15_042.5,
                    "request_trace_id": "a" * 32,
                    "request_phase": "body",
                    "online_at_start": True,
                    "visibility_at_start": "visible",
                    "error_name": "AbortError",
                    "response_request_id": "upstream-request-1",
                    "resource_path": "/shop/104/cotton-01.webp?token=private#hash",
                    "resource_status": 404,
                    "resource_timing_available": True,
                },
            },
        },
    )

    assert response.status_code == 202
    assert response.json()["error_id"] == "client-error-1"
    assert received["error_id"] == "client-error-1"
    assert received["path"] == "/documents"
    assert received["context"] == {
        "release": "web@abc123",
        "viewport": "390x844",
        "online": True,
        "page_origin": "https://hcca.tw",
        "api_origin": "https://api.hcca.tw",
        "diagnostics": {
            "failure_kind": "timeout",
            "request_method": "GET",
            "request_path": "/shop/products/123",
            "request_attempts": 2,
            "request_timeout_ms": 15_000,
            "request_elapsed_ms": 15_042.5,
            "request_trace_id": "a" * 32,
            "request_phase": "body",
            "online_at_start": True,
            "visibility_at_start": "visible",
            "error_name": "AbortError",
            "response_request_id": "upstream-request-1",
            "resource_path": "/shop/104/cotton-01.webp",
            "resource_status": 404,
            "resource_timing_available": True,
        },
    }
    assert "do-not-retain" not in str(received["context"])


def test_client_diagnostics_accept_incident_evidence_and_reject_invalid_values() -> None:
    from pydantic import ValidationError

    from api.routers.admin_system import ClientErrorDiagnostics

    diagnostics = ClientErrorDiagnostics.model_validate(
        {
            "request_hidden_ms": 90_000,
            "timeout_timer_delay_ms": 97_000,
            "resource_probe_status": 403,
            "resource_probe_result": "response",
            "image_connected": True,
            "image_complete": True,
            "image_natural_width": 0,
            "image_loading": "lazy",
            "error_digest": "ssr-cause",
            "render_source": "server-rendering",
            "route_path": "/admin/system?token=private#hash",
            "document_ready_state": "complete",
        }
    )
    assert diagnostics.route_path == "/admin/system"
    assert diagnostics.resource_probe_status == 403
    assert diagnostics.model_dump(exclude_none=True)["request_hidden_ms"] == 90_000
    for invalid in (
        {"request_hidden_ms": -1},
        {"timeout_timer_delay_ms": float("inf")},
        {"resource_probe_status": 999},
        {"image_natural_width": -1},
        {"error_digest": "x" * 129},
    ):
        with pytest.raises(ValidationError):
            ClientErrorDiagnostics.model_validate(invalid)


async def test_validation_errors_are_recorded(
    client: AsyncClient,
    isolated_error_audit,
) -> None:
    response = await client.post("/system/client-errors", json={"scope": "invalid"})

    assert response.status_code == 422
    items = await isolated_error_audit.get_recent_errors()
    assert any(item["category"] == "validation" for item in items)


async def test_expected_http_errors_are_not_recorded(
    client: AsyncClient,
    isolated_error_audit,
) -> None:
    response = await client.get("/route-that-does-not-exist")

    assert response.status_code == 404
    items = await isolated_error_audit.get_recent_errors()
    assert not any(item["category"] == "http" and item["status_code"] == 404 for item in items)


async def test_unauthorized_request_is_not_recorded(
    client: AsyncClient,
    isolated_error_audit,
) -> None:
    response = await client.get("/tasks/count")

    assert response.status_code == 401
    assert await isolated_error_audit.get_recent_errors() == []


async def test_readiness_503_is_not_recorded_as_application_error(
    client: AsyncClient,
    isolated_error_audit,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api import main as api_main

    async def db_ok() -> tuple[bool, str | None]:
        return True, None

    async def redis_failed() -> tuple[bool, str | None]:
        return False, "ConnectionError"

    monkeypatch.setattr(api_main, "_check_database", db_ok)
    monkeypatch.setattr(api_main, "_check_redis", redis_failed)

    response = await client.get("/ready")

    assert response.status_code == 503
    assert await isolated_error_audit.get_recent_errors() == []


def test_module_maintenance_503_is_suppressed_but_other_503_is_retained() -> None:
    assert error_audit.is_suppressed_error(
        category="http", path="/elections/public", status_code=503
    )
    assert not error_audit.is_suppressed_error(
        category="http", path="/auth/google/login", status_code=503
    )


async def test_recent_errors_filters_module_maintenance_503(
    isolated_error_audit,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def legacy_lrange(*_args, **_kwargs) -> list[str]:
        return [
            json.dumps(
                {
                    "signature": "http:HTTPException:GET:/elections/public",
                    "error_id": "module-maintenance-503",
                    "category": "http",
                    "exc_type": "HTTPException",
                    "method": "GET",
                    "path": "/elections/public",
                    "status_code": 503,
                    "occurred_at": 2,
                }
            ),
            json.dumps(
                {
                    "signature": "http:HTTPException:GET:/auth/google/login",
                    "error_id": "real-503",
                    "category": "http",
                    "exc_type": "HTTPException",
                    "method": "GET",
                    "path": "/auth/google/login",
                    "status_code": 503,
                    "occurred_at": 1,
                }
            ),
        ]

    monkeypatch.setattr(security.redis_client, "lrange", legacy_lrange)

    items = await isolated_error_audit.get_recent_errors()

    assert [item["error_id"] for item in items] == ["real-503"]
