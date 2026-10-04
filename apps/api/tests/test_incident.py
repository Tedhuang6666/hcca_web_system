from __future__ import annotations

import csv
from datetime import UTC, datetime, timedelta
from io import StringIO
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.system_incident import IncidentSeverity, IncidentStatus, SystemIncident
from api.services.incident import (
    auto_resolve_stale_incidents,
    count_incident_metrics,
    create_error_fingerprint,
    export_incidents_csv,
    list_incident_events,
    normalize_client_incident_message,
    normalize_error_message,
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


async def test_incident_metrics_count_all_rows_and_active_repeats(
    db_session: AsyncSession,
) -> None:
    now = datetime.now(UTC)
    incidents = [
        SystemIncident(
            id=uuid4(),
            error_id=f"metric-error-{index}",
            fingerprint=f"metric-fingerprint-{index}",
            severity=IncidentSeverity.P2,
            status=IncidentStatus.OPEN,
            service="api",
            environment="test",
            title=f"Issue {index}",
            summary=None,
            first_seen_at=now,
            last_seen_at=now,
            occurrence_count=2 if index < 8 else 1,
        )
        for index in range(205)
    ]
    incidents.extend(
        [
            SystemIncident(
                id=uuid4(),
                error_id="metric-resolved",
                fingerprint="metric-resolved",
                severity=IncidentSeverity.P2,
                status=IncidentStatus.RESOLVED,
                service="api",
                environment="test",
                title="Resolved issue",
                summary=None,
                first_seen_at=now,
                last_seen_at=now,
                occurrence_count=4,
            ),
            SystemIncident(
                id=uuid4(),
                error_id="metric-regression",
                fingerprint="metric-regression",
                severity=IncidentSeverity.P2,
                status=IncidentStatus.REGRESSION,
                service="api",
                environment="test",
                title="Regressed issue",
                summary=None,
                first_seen_at=now,
                last_seen_at=now,
                occurrence_count=2,
            ),
            SystemIncident(
                id=uuid4(),
                error_id="metric-ignored",
                fingerprint="metric-ignored",
                severity=IncidentSeverity.P2,
                status=IncidentStatus.IGNORED,
                service="api",
                environment="test",
                title="Ignored issue",
                summary=None,
                first_seen_at=now,
                last_seen_at=now,
                occurrence_count=5,
            ),
        ]
    )
    db_session.add_all(incidents)
    await db_session.flush()

    assert await count_incident_metrics(db_session) == {
        "active_issues": 206,
        "repeated_active_issues": 9,
        "regressions": 1,
        "resolved_issues": 1,
    }


def test_asyncpg_statement_sequence_is_normalized_for_issue_grouping() -> None:
    first = 'prepared statement "__asyncpg_stmt_35__" already exists'
    second = 'prepared statement "__asyncpg_stmt_206__" already exists'

    assert normalize_error_message(first) == normalize_error_message(second)
    assert create_error_fingerprint(
        service="api",
        exception_type="ProgrammingError",
        path="/health",
        message=first,
    ) == create_error_fingerprint(
        service="api",
        exception_type="ProgrammingError",
        path="/health",
        message=second,
    )


async def test_export_incidents_csv_contains_event_timeline(
    db_session: AsyncSession,
) -> None:
    await _create_incident(db_session)
    await db_session.commit()

    report = await export_incidents_csv(
        db_session,
        slow_queries=[
            {
                "template": "SELECT * FROM survey_answers WHERE survey_id = ?",
                "max_ms": 1_234.5,
                "occurrences": 7,
                "last_seen": 1_790_573_400.0,
                "paths": [{"path": "/surveys/example", "occurrences": 7}],
            }
        ],
    )

    assert "incident_id,error_id,status" in report
    assert "web: window.error at /documents" in report
    assert "stack_head" in report
    assert "390x844" in report
    rows = list(csv.DictReader(StringIO(report)))
    slow_query = next(row for row in rows if row["record_type"] == "slow_query")
    assert slow_query["slow_query_template"] == "SELECT * FROM survey_answers WHERE survey_id = ?"
    assert slow_query["slow_query_max_ms"] == "1234.5"
    assert slow_query["severity"] == IncidentSeverity.P2


def test_normalize_client_incident_message_groups_cache_busted_resources() -> None:
    first_resource = (
        "資源載入失敗 [https://hcca.tw/api/uploads/surveys/"
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png?signature=first]"
    )
    second_resource = (
        "資源載入失敗 [https://hcca.tw/api/uploads/surveys/"
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png?signature=second]"
    )
    assert normalize_client_incident_message(first_resource, "resource:img") == (
        "資源載入失敗 [https://hcca.tw/api/uploads/surveys/{asset}.png]"
    )
    assert normalize_client_incident_message(first_resource, "resource:img") == (
        normalize_client_incident_message(second_resource, "resource:img")
    )
    first_csp = normalize_client_incident_message(
        "CSP blocked connect-src: https://hcca.tw/surveys?_rsc=first", "securitypolicyviolation"
    )
    second_csp = normalize_client_incident_message(
        "CSP blocked connect-src: https://hcca.tw/regulations/123?_rsc=second",
        "securitypolicyviolation",
    )
    assert first_csp == "CSP blocked connect-src: https://hcca.tw"
    assert first_csp == second_csp
    assert normalize_client_incident_message(
        "CSP blocked frame-src: blob", "securitypolicyviolation"
    ) == "CSP blocked frame-src: blob:"
    assert normalize_client_incident_message(
        "CSP blocked connect-src: https://api.example.org/surveys", "securitypolicyviolation"
    ) != first_csp
