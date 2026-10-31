from __future__ import annotations

import csv
import json
from datetime import UTC, datetime, timedelta
from io import StringIO
from uuid import uuid4

import pytest
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
    persist_client_error_incident,
    sanitize_incident_details,
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
    recent_incident = SystemIncident(
        id=uuid4(),
        error_id="recent-error",
        fingerprint="recent-fingerprint",
        severity=IncidentSeverity.P3,
        status=IncidentStatus.OPEN,
        service="web",
        environment="test",
        title="Recent issue",
        summary="Seen within the inactivity window",
        first_seen_at=now - timedelta(days=1),
        last_seen_at=now - timedelta(hours=23),
    )
    db_session.add(recent_incident)
    await db_session.commit()

    resolved = await auto_resolve_stale_incidents(
        db_session,
        inactivity_hours=24,
        now=now,
    )
    await db_session.commit()

    assert [item.id for item in resolved] == [incident.id]
    assert incident.status == IncidentStatus.RESOLVED
    assert recent_incident.status == IncidentStatus.OPEN
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


def test_python_object_addresses_are_normalized_for_issue_grouping() -> None:
    first = "Response validation failed: <api.models.shop.Product object at 0x7bb967e35730>"
    second = "Response validation failed: <api.models.shop.Product object at 0x7bb967fcecc0>"

    assert normalize_error_message(first) == normalize_error_message(second)
    assert "at {address}" in normalize_error_message(first)
    assert create_error_fingerprint(
        service="api",
        exception_type="ResponseValidationError",
        path="/shop/products",
        message=first,
    ) == create_error_fingerprint(
        service="api",
        exception_type="ResponseValidationError",
        path="/shop/products",
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


async def test_slow_query_export_keeps_predicates_and_correlation(db_session: AsyncSession) -> None:
    template = "SELECT " + ", ".join(f"orders.column_{i}" for i in range(30))
    template += " FROM orders WHERE orders.class_id = ? GROUP BY orders.activity_id"
    report = await export_incidents_csv(
        db_session,
        slow_queries=[
            {
                "template": template,
                "max_ms": 1_097.4,
                "occurrences": 3,
                "fingerprint": "e" * 64,
                "template_truncated": False,
                "measurement": "sqlalchemy_cursor_wall_time",
                "threshold_ms": 50,
                "max_trace_id": "a" * 32,
                "max_request_path": "/shop/close-status",
            }
        ],
    )
    row = next(csv.DictReader(StringIO(report)))
    assert row["slow_query_template"] == template
    evidence = json.loads(row["event_timeline"])[0]["details"]
    assert evidence["max_trace_id"] == "a" * 32
    assert evidence["measurement"] == "sqlalchemy_cursor_wall_time"
    assert evidence["template_truncated"] is False


async def test_export_excludes_closed_history_before_applying_limit(db_session) -> None:
    active = await _create_incident(db_session)
    active.last_seen_at = datetime.now(UTC) - timedelta(days=1)
    for closed_status in (IncidentStatus.RESOLVED, IncidentStatus.IGNORED):
        db_session.add(
            SystemIncident(
                id=uuid4(),
                error_id=str(uuid4()),
                fingerprint=str(uuid4()),
                severity=IncidentSeverity.P3,
                status=closed_status,
                service="web",
                environment="test",
                title="Closed historical incident",
                first_seen_at=datetime.now(UTC),
                last_seen_at=datetime.now(UTC),
            )
        )
    await db_session.flush()
    rows = list(csv.DictReader(StringIO(await export_incidents_csv(db_session, limit=1))))
    assert [row["incident_id"] for row in rows] == [str(active.id)]
    assert not list(
        csv.DictReader(
            StringIO(await export_incidents_csv(db_session, status=IncidentStatus.RESOLVED))
        )
    )


def test_react_error_codes_remain_distinct_in_incident_fingerprints() -> None:
    first = "Minified React error #419; visit https://react.dev/errors/419"
    second = first.replace("419", "423")
    assert "#419" in normalize_error_message(first)
    assert normalize_error_message(first) != normalize_error_message(second)


def test_traceback_keeps_root_cause_and_long_client_stack() -> None:
    details = sanitize_incident_details(
        {
            "traceback_head": "middleware frame\n" * 1000 + "ValueError: root cause",
            "stack_head": "client frame\n" * 400,
            "message": "ordinary message" * 300,
        }
    )
    assert len(details["traceback_head"]) == 6000
    assert details["traceback_head"].endswith("ValueError: root cause")
    assert len(details["stack_head"]) > 2000
    assert len(details["message"]) == 2000


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
    assert (
        normalize_client_incident_message("CSP blocked frame-src: blob", "securitypolicyviolation")
        == "CSP blocked frame-src: blob:"
    )
    assert (
        normalize_client_incident_message(
            "CSP blocked connect-src: https://api.example.org/surveys", "securitypolicyviolation"
        )
        != first_csp
    )


async def test_client_api_incidents_group_by_sanitized_request_path(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def persist(**kwargs):
        captured.update(kwargs)
        return "incident"

    monkeypatch.setattr("api.services.incident.persist_error_incident", persist)

    result = await persist_client_error_incident(
        error_id="client-error-1",
        message="Failed to fetch",
        stack="TypeError: Failed to fetch",
        scope="api.network",
        path="/dashboard",
        context={
            "diagnostics": {
                "request_method": "get",
                "request_path": "/shop/products/123?token=private",
                "request_attempts": 3,
            }
        },
        trace_id="trace-1",
        request_id="request-1",
        client_ip=None,
        user_agent=None,
    )

    assert result == "incident"
    assert captured["path"] == "/shop/products/{id}"
    assert captured["message"] == "api.network GET"
    assert captured["title"] == "web: api.network GET /shop/products/{id}"
    details = captured["details"]
    assert isinstance(details, dict)
    client_context = details["client_context"]
    assert client_context["diagnostics"]["request_path"] == "/shop/products/{id}"
    assert "private" not in str(client_context)


async def test_offline_client_error_does_not_create_an_incident(monkeypatch) -> None:
    persisted = False

    async def persist(**_kwargs):
        nonlocal persisted
        persisted = True

    monkeypatch.setattr("api.services.incident.persist_error_incident", persist)

    result = await persist_client_error_incident(
        error_id="client-error-offline",
        message="離線狀態：/shop/products",
        stack="",
        scope="api.offline",
        path="/shop",
        context={"diagnostics": {"failure_kind": "offline"}},
        trace_id=None,
        request_id=None,
        client_ip=None,
        user_agent=None,
    )

    assert result is None
    assert not persisted


@pytest.mark.parametrize(
    "scope,message,diagnostics,filtered",
    [
        ("resource:style", "資源載入失敗", {}, True),
        ("securitypolicyviolation", "CSP blocked style-src-elem: inline", {}, False),
        (
            "api.timeout",
            "Timeout",
            {"request_method": "POST", "request_path": "/analytics/page-views"},
            True,
        ),
        (
            "api.network",
            "Failed to fetch",
            {"request_method": "POST", "request_path": "/analytics/client-metrics/batch"},
            True,
        ),
        (
            "api.timeout",
            "Timeout",
            {"request_method": "POST", "request_path": "/shop/registrations"},
            False,
        ),
        (
            "api.network",
            "Failed to fetch",
            {"request_method": "GET", "request_path": "/analytics/page-views"},
            False,
        ),
    ],
)
async def test_optional_client_observations_keep_real_failures(
    monkeypatch, scope, message, diagnostics, filtered
) -> None:
    calls = []

    async def persist(**kwargs):
        calls.append(kwargs)
        return "incident"

    monkeypatch.setattr("api.services.incident.persist_error_incident", persist)
    await persist_client_error_incident(
        error_id="optional-observation",
        message=message,
        stack="",
        scope=scope,
        path="/shop",
        context={"diagnostics": diagnostics},
        trace_id=None,
        request_id=None,
        client_ip=None,
        user_agent=None,
    )
    assert len(calls) == (0 if filtered else 1)


async def test_auto_resolve_preserves_assigned_incidents(db_session, member_user) -> None:
    old = datetime.now(UTC) - timedelta(days=2)
    row = SystemIncident(
        error_id="assigned-incident",
        fingerprint="assigned-fingerprint",
        severity="P3",
        status=IncidentStatus.OPEN,
        service="web",
        environment="test",
        title="Assigned issue",
        first_seen_at=old,
        last_seen_at=old,
        occurrence_count=1,
        assigned_to=member_user.id,
    )
    db_session.add(row)
    await db_session.flush()
    assert await auto_resolve_stale_incidents(db_session, inactivity_hours=24) == []
    assert row.status == IncidentStatus.OPEN


@pytest.mark.parametrize(
    "message,filtered",
    [
        ("Script error.", True),
        (
            "undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')",
            True,
        ),
        ("Error invoking postMessage: Java object is gone", True),
        ("undefined is not an object (evaluating 'window.webkit.messageHandlers')", True),
        ("Cannot read properties of undefined (reading 'classList')", False),
        ("Minified React error #419", False),
    ],
)
async def test_client_runtime_noise_filter_keeps_application_failures(
    monkeypatch, message: str, filtered: bool
) -> None:
    calls = []

    async def persist(**kwargs):
        calls.append(kwargs)
        return "incident"

    monkeypatch.setattr("api.services.incident.persist_error_incident", persist)
    result = await persist_client_error_incident(
        error_id="runtime-filter",
        message=message,
        stack="",
        scope="window.error",
        path="/shop",
        context={},
        trace_id=None,
        request_id=None,
        client_ip=None,
        user_agent=None,
    )

    assert len(calls) == (0 if filtered else 1)
    assert result == (None if filtered else "incident")


async def test_offline_network_and_resource_errors_do_not_create_incidents(monkeypatch) -> None:
    persisted = False

    async def persist(**_kwargs):
        nonlocal persisted
        persisted = True

    monkeypatch.setattr("api.services.incident.persist_error_incident", persist)

    for scope, failure_kind, online in (
        ("api.network", "network", False),
        ("api.timeout", "timeout", False),
        ("api.refresh-network", "network", False),
        ("resource:img", "resource", False),
        ("api.network", "offline", True),
    ):
        result = await persist_client_error_incident(
            error_id=f"client-error-{scope}",
            message="Request failed",
            stack="",
            scope=scope,
            path="/dashboard",
            context={"online": online, "diagnostics": {"failure_kind": failure_kind}},
            trace_id=None,
            request_id=None,
            client_ip=None,
            user_agent=None,
        )

        assert result is None

    assert not persisted


async def test_report_only_csp_error_does_not_create_an_incident(monkeypatch) -> None:
    persisted = False

    async def persist(**_kwargs):
        nonlocal persisted
        persisted = True

    monkeypatch.setattr("api.services.incident.persist_error_incident", persist)

    result = await persist_client_error_incident(
        error_id="client-error-report-only-csp",
        message="CSP violated connect-src: https://example.org",
        stack="",
        scope="securitypolicyviolation",
        path="/dashboard",
        context={
            "online": True,
            "diagnostics": {"failure_kind": "csp", "csp_disposition": "report"},
        },
        trace_id=None,
        request_id=None,
        client_ip=None,
        user_agent=None,
    )

    assert result is None
    assert not persisted


async def test_enforced_csp_error_remains_an_incident(monkeypatch) -> None:
    captured: dict[str, object] = {}

    async def persist(**kwargs):
        captured.update(kwargs)
        return "incident"

    monkeypatch.setattr("api.services.incident.persist_error_incident", persist)

    result = await persist_client_error_incident(
        error_id="client-error-enforced-csp",
        message="CSP blocked frame-src: blob",
        stack="",
        scope="securitypolicyviolation",
        path="/dashboard",
        context={
            "online": True,
            "diagnostics": {"failure_kind": "csp", "csp_disposition": "enforce"},
        },
        trace_id=None,
        request_id=None,
        client_ip=None,
        user_agent=None,
    )

    assert result == "incident"
    assert captured["path"] == "browser-csp"
    assert captured["title"] == "web: securitypolicyviolation (site-wide CSP)"
