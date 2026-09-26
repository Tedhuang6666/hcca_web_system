from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.system_incident import IncidentSeverity, IncidentStatus
from api.services.incident import (
    auto_resolve_stale_incidents,
    create_error_fingerprint,
    export_incidents_csv,
    list_incident_events,
    upsert_incident,
)


async def _create_incident(session: AsyncSession, *, error_id: str = "error-1"):
    return await upsert_incident(
        session,
        error_id=error_id,
        fingerprint=create_error_fingerprint(
            service="web",
            exception_type="ClientError",
            path="/documents",
            message="Chunk loading failed for 123",
        ),
        severity=IncidentSeverity.P3,
        status_code=0,
        service="web",
        environment="test",
        release_version="web@test",
        title="web: window.error at /documents",
        summary="Chunk loading failed",
        trace_id="trace-1",
        request_id="request-1",
        details={"stack_head": "Error: Chunk loading failed", "viewport": "390x844"},
    )


async def test_auto_resolve_stale_incident_records_resolution_event(
    db_session: AsyncSession,
) -> None:
    incident = await _create_incident(db_session)
    now = datetime.now(UTC)
    incident.last_seen_at = now - timedelta(hours=25)
    await db_session.commit()

    resolved = await auto_resolve_stale_incidents(
        db_session,
        inactivity_hours=24,
        now=now,
    )
    await db_session.commit()

    assert [item.id for item in resolved] == [incident.id]
    assert incident.status == IncidentStatus.RESOLVED
    assert incident.resolved_at == now
    assert incident.resolution_note == "系統自動結案：已連續 24 小時未再觀測到相同錯誤。"
    events = await list_incident_events(db_session, incident.id)
    assert events[0].event_type == "auto_resolved"
    assert events[0].details["inactivity_hours"] == 24


async def test_resolved_incident_reopens_as_regression(
    db_session: AsyncSession,
) -> None:
    incident = await _create_incident(db_session)
    incident.status = IncidentStatus.RESOLVED
    incident.resolved_at = datetime.now(UTC)
    await db_session.commit()

    repeated = await _create_incident(db_session, error_id="error-2")
    await db_session.commit()

    assert repeated.id == incident.id
    assert repeated.status == IncidentStatus.REGRESSION
    assert repeated.resolved_at is None
    assert repeated.occurrence_count == 2
    events = await list_incident_events(db_session, incident.id)
    assert events[0].event_type == "regressed"
    assert events[0].details["error_id"] == "error-2"


async def test_export_incidents_csv_contains_event_timeline(
    db_session: AsyncSession,
) -> None:
    await _create_incident(db_session)
    await db_session.commit()

    report = await export_incidents_csv(db_session)

    assert "incident_id,error_id,status" in report
    assert "web: window.error at /documents" in report
    assert "stack_head" in report
    assert "390x844" in report
