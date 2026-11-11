"""2026-11-11 事件報告中的誤報與事件生命週期回歸。"""

from datetime import UTC, datetime, timedelta

import pytest

from api.models.system_incident import IncidentStatus
from api.services.incident import (
    append_incident_event,
    auto_resolve_stale_incidents,
    list_incident_events,
    persist_client_error_incident,
    upsert_incident,
)


async def _observe(session, error_id="first"):
    return await upsert_incident(
        session,
        error_id=error_id,
        fingerprint="report-regression",
        severity="P3",
        status_code=0,
        service="web",
        environment="test",
        release_version="test-release",
        title="web: api.timeout GET /system/module-status",
        summary="Timeout",
        trace_id=None,
        request_id=None,
    )


async def test_inactivity_reopens_without_claiming_a_verified_fix_regressed(db_session):
    incident = await _observe(db_session)
    incident.last_seen_at = datetime.now(UTC) - timedelta(hours=25)
    await db_session.flush()
    await auto_resolve_stale_incidents(db_session, inactivity_hours=24)
    await db_session.commit()

    repeated = await _observe(db_session, "repeated")

    assert repeated.id == incident.id
    assert repeated.status == IncidentStatus.OPEN
    assert repeated.resolved_at is None
    assert repeated.resolution_note is None
    assert repeated.occurrence_count == 2
    events = await list_incident_events(db_session, incident.id)
    assert events[0].event_type == "reopened"
    assert any(event.event_type == "auto_resolved" for event in events)


@pytest.mark.parametrize("earlier_auto_resolution", [False, True])
async def test_verified_resolution_still_regresses_and_clears_stale_note(
    db_session, earlier_auto_resolution
):
    incident = await _observe(db_session)
    if earlier_auto_resolution:
        incident.last_seen_at = datetime.now(UTC) - timedelta(hours=25)
        await db_session.flush()
        await auto_resolve_stale_incidents(db_session, inactivity_hours=24)
    incident.status = IncidentStatus.RESOLVED
    incident.resolved_at = datetime.now(UTC)
    incident.resolution_note = "已驗證修復"
    await append_incident_event(
        db_session,
        incident_id=incident.id,
        event_type="status_changed",
        actor_id=None,
        details={"status": "resolved"},
    )
    await db_session.commit()

    repeated = await _observe(db_session, "regressed")

    assert repeated.status == IncidentStatus.REGRESSION
    assert repeated.resolution_note is None
    assert repeated.resolved_at is None
    assert (await list_incident_events(db_session, incident.id))[0].event_type == "regressed"


@pytest.mark.parametrize(
    "overrides,filtered",
    [
        ({}, True),
        ({"request_method": "POST"}, False),
        ({"request_hidden_ms": 1_000}, False),
        ({"visibility_at_start": "visible", "request_hidden_ms": 14_000}, False),
        ({"request_hidden_ms": None}, False),
        ({"request_elapsed_ms": float("nan")}, False),
        ({"request_hidden_ms": True}, False),
        ({"request_hidden_ms": 30_000}, False),
        ({"request_timeout_ms": 0}, False),
        (
            {
                "visibility_at_start": "visible",
                "request_elapsed_ms": 90_000,
                "request_hidden_ms": 89_000,
                "timeout_timer_delay_ms": 75_000,
            },
            True,
        ),
        (
            {
                "visibility_at_start": "visible",
                "request_elapsed_ms": 90_000,
                "request_hidden_ms": 70_000,
                "timeout_timer_delay_ms": 75_000,
            },
            False,
        ),
    ],
)
async def test_only_proven_background_read_timeouts_are_observations(
    monkeypatch, overrides, filtered
):
    calls = []

    async def persist(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr("api.services.incident.persist_error_incident", persist)
    await persist_client_error_incident(
        error_id="background-timeout",
        message="Timeout",
        stack="",
        scope="api.timeout",
        path="/shop",
        context={
            "visibility_state": "hidden",
            "diagnostics": {
                "request_method": "GET",
                "request_path": "/system/module-status",
                "visibility_at_start": "hidden",
                "request_timeout_ms": 15_000,
                "request_elapsed_ms": 15_010,
                "request_hidden_ms": 15_010,
                **overrides,
            },
        },
        trace_id=None,
        request_id=None,
        client_ip=None,
        user_agent=None,
    )
    assert len(calls) == (0 if filtered else 1)
