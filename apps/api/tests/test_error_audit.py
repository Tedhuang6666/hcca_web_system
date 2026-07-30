from __future__ import annotations

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


async def test_client_error_endpoint_is_anonymous_and_returns_error_id(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def record(**_kwargs) -> str:
        return "client-error-1"

    from api.routers import admin_system

    monkeypatch.setattr(admin_system, "record_client_error", record)
    response = await client.post(
        "/system/client-errors",
        json={
            "scope": "window.error",
            "message": "Something broke",
            "stack": "Error: Something broke",
            "pathname": "/documents",
        },
    )

    assert response.status_code == 202
    assert response.json()["error_id"] == "client-error-1"


async def test_validation_errors_are_recorded(
    client: AsyncClient,
    isolated_error_audit,
) -> None:
    response = await client.post("/system/client-errors", json={"scope": "invalid"})

    assert response.status_code == 422
    items = await isolated_error_audit.get_recent_errors()
    assert any(item["category"] == "validation" for item in items)


async def test_http_errors_are_recorded(
    client: AsyncClient,
    isolated_error_audit,
) -> None:
    response = await client.get("/route-that-does-not-exist")

    assert response.status_code == 404
    items = await isolated_error_audit.get_recent_errors()
    assert any(item["category"] == "http" and item["status_code"] == 404 for item in items)
