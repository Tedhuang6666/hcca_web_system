from __future__ import annotations

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select

from api.core.config import settings
from api.models.observability import ObservabilityRelease
from api.models.system_incident import IncidentStatus, SystemIncident, SystemIncidentEvent
from api.services.incident import create_error_fingerprint, upsert_incident

_spec = importlib.util.spec_from_file_location(
    "incident_cleanup", Path(__file__).parents[1] / "scripts/resolve_known_incidents.py"
)
assert _spec and _spec.loader
cleanup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cleanup)

RELEASE = "a" * 40
BEFORE = datetime(2026, 10, 20, tzinfo=UTC)
TITLE = "web: api.network at /shop"
MESSAGE = "Response cannot have a body with the given status."


def incident(**kwargs) -> SystemIncident:
    return SystemIncident(
        id=uuid4(),
        error_id=str(uuid4()),
        fingerprint=str(uuid4()),
        status=IncidentStatus.OPEN,
        service="web",
        environment="test",
        title=TITLE,
        summary=MESSAGE,
        first_seen_at=BEFORE - timedelta(days=2),
        last_seen_at=BEFORE - timedelta(days=1),
        occurrence_count=3,
        **kwargs,
    )


@pytest.mark.parametrize(
    "service,title,summary,matched",
    [
        ("web", TITLE, MESSAGE, True),
        ("web", "web: api.network at /shop", "Failed to fetch", False),
        ("web", "web: api.timeout GET /auth/me", "api.timeout GET", False),
        ("hcca-api", "hcca-api: ConnectionRefusedError at /auth/me", "Connection refused", False),
        (
            "web",
            "web: securitypolicyviolation at /shop",
            "CSP blocked connect-src: https://hcca.tw/api/tasks",
            True,
        ),
        (
            "web",
            "web: securitypolicyviolation at /shop",
            "CSP blocked connect-src: https://hcca.tw.evil.test/",
            False,
        ),
        (
            "web",
            "web: securitypolicyviolation at /shop",
            "CSP blocked style-src-elem: inline",
            False,
        ),
        (
            "web",
            "web: securitypolicyviolation (site-wide CSP)",
            "CSP blocked connect-src: https://hcca.tw",
            False,
        ),
        (
            "hcca-api",
            "hcca-api: ResponseValidationError at /shop/products",
            "max_quantity_per_user MissingGreenlet",
            True,
        ),
        (
            "hcca-api",
            "hcca-api: ResponseValidationError at /shop/products",
            "price MissingGreenlet",
            False,
        ),
        (
            "hcca-api",
            "hcca-api: ValueError at /email/preview",
            "佔位符渲染失敗：unexpected '}'",
            True,
        ),
        ("hcca-api", "hcca-api: ValueError at /email/preview", "other problem", False),
        (
            "hcca-api",
            "hcca-api: IntegrityError at /shop/categories/example",
            "shop_delegation_links_category_id_fkey",
            True,
        ),
    ],
)
def test_known_fix_matches_only_confirmed_failures(service, title, summary, matched) -> None:
    row = incident()
    row.service, row.title, row.summary = service, title, summary
    assert (cleanup.known_fix(row) is not None) is matched


async def seed(db_session, monkeypatch):
    monkeypatch.setattr(settings, "APP_RELEASE", RELEASE)
    monkeypatch.setattr(settings, "ENVIRONMENT", "test")
    db_session.add(
        ObservabilityRelease(
            release=RELEASE,
            commit_sha=RELEASE,
            environment="test",
            deployed_at=BEFORE,
        )
    )
    rows = [incident() for _ in range(6)]
    rows[1].last_seen_at = BEFORE  # New observations must survive.
    rows[2].environment = "production"
    rows[3].status = IncidentStatus.INVESTIGATING
    rows[4].status = IncidentStatus.RESOLVED
    rows[5].summary = "Load failed"
    db_session.add_all(rows)
    await db_session.flush()
    return rows


async def test_preview_apply_and_idempotence_preserve_unrelated_incidents(db_session, monkeypatch):
    rows = await seed(db_session, monkeypatch)
    kwargs = dict(before=BEFORE, environment="test", release=RELEASE)
    preview = await cleanup.reconcile(db_session, **kwargs)
    assert preview["count"] == 1
    assert rows[0].status == IncidentStatus.OPEN
    assert not (await db_session.scalars(select(SystemIncidentEvent))).all()

    result = await cleanup.reconcile(db_session, **kwargs, apply=True, expected_count=1)
    assert result["count"] == 1
    assert rows[0].status == IncidentStatus.RESOLVED
    assert "315034c3" in rows[0].resolution_note
    events = (await db_session.scalars(select(SystemIncidentEvent))).all()
    assert len(events) == 1
    assert events[0].event_type == "known_fix_resolved"
    assert events[0].details["verified_release"] == RELEASE
    assert [row.status for row in rows[1:]] == [
        IncidentStatus.OPEN,
        IncidentStatus.OPEN,
        IncidentStatus.INVESTIGATING,
        IncidentStatus.RESOLVED,
        IncidentStatus.OPEN,
    ]
    assert (await cleanup.reconcile(db_session, **kwargs, apply=True, expected_count=0))[
        "count"
    ] == 0


async def test_changed_candidate_count_aborts_without_resolving(db_session, monkeypatch):
    rows = await seed(db_session, monkeypatch)
    with pytest.raises(ValueError, match="候選筆數"):
        await cleanup.reconcile(
            db_session,
            before=BEFORE,
            environment="test",
            release=RELEASE,
            apply=True,
            expected_count=2,
        )
    assert rows[0].status == IncidentStatus.OPEN
    assert not (await db_session.scalars(select(SystemIncidentEvent))).all()


async def test_cleanup_keeps_regression_detection(db_session, monkeypatch):
    rows = await seed(db_session, monkeypatch)
    row = rows[0]
    row.fingerprint = create_error_fingerprint(
        service="web",
        exception_type="ClientError",
        path="/shop",
        message=MESSAGE,
    )
    await db_session.flush()
    await cleanup.reconcile(
        db_session,
        before=BEFORE,
        environment="test",
        release=RELEASE,
        apply=True,
        expected_count=1,
    )
    repeated = await upsert_incident(
        db_session,
        error_id=str(uuid4()),
        fingerprint=row.fingerprint,
        severity="P3",
        status_code=0,
        service="web",
        environment="test",
        release_version="new-release",
        title=TITLE,
        summary=MESSAGE,
        trace_id=None,
        request_id=None,
    )
    assert repeated.id == row.id
    assert repeated.status == IncidentStatus.REGRESSION
    assert repeated.resolved_at is None


@pytest.mark.parametrize("bad_argument", ["release", "environment", "before"])
async def test_reconciliation_rejects_wrong_target(db_session, monkeypatch, bad_argument):
    rows = await seed(db_session, monkeypatch)
    kwargs = dict(before=BEFORE, environment="test", release=RELEASE, apply=True, expected_count=1)
    kwargs[bad_argument] = {
        "release": "b" * 40,
        "environment": "production",
        "before": BEFORE + timedelta(days=1),
    }[bad_argument]
    with pytest.raises(ValueError):
        await cleanup.reconcile(db_session, **kwargs)
    assert rows[0].status == IncidentStatus.OPEN
