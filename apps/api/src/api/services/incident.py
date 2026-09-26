"""Incident fingerprinting, deduplication, and persistence."""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import re
from datetime import UTC, datetime, timedelta
from io import StringIO
from typing import Any
from uuid import UUID, uuid4

from celery import current_app
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.system_incident import (
    IncidentSeverity,
    IncidentStatus,
    SystemIncident,
    SystemIncidentEvent,
)

logger = logging.getLogger(__name__)

_UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f-]{27,}\b", re.IGNORECASE)
_NUMBER_RE = re.compile(r"\b\d+\b")
_WHITESPACE_RE = re.compile(r"\s+")
_SENSITIVE_RE = re.compile(
    r"(?i)(bearer\s+|(?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;]+"
)
_ACTIVE_STATUSES = (
    IncidentStatus.OPEN,
    IncidentStatus.INVESTIGATING,
    IncidentStatus.MITIGATED,
    IncidentStatus.MONITORING,
    IncidentStatus.REGRESSION,
)
_AUTO_RESOLVABLE_STATUSES = (
    IncidentStatus.OPEN,
    IncidentStatus.MITIGATED,
    IncidentStatus.REGRESSION,
)


def sanitize_incident_text(message: str, limit: int = 2000) -> str:
    sanitized = _SENSITIVE_RE.sub(r"\1[Filtered]", message)
    return sanitized[:limit]


def sanitize_incident_details(value: Any, *, depth: int = 0) -> Any:
    """Keep durable incident metadata useful without persisting secrets or unbounded payloads."""
    if depth > 4:
        return "[Truncated]"
    if isinstance(value, str):
        return sanitize_incident_text(value, 2_000)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {
            str(key)[:100]: sanitize_incident_details(item, depth=depth + 1)
            for key, item in list(value.items())[:50]
        }
    if isinstance(value, (list, tuple)):
        return [sanitize_incident_details(item, depth=depth + 1) for item in value[:50]]
    return sanitize_incident_text(str(value), 2_000)


def normalize_error_message(message: str) -> str:
    """Remove request-specific values before generating an incident fingerprint."""
    normalized = _UUID_RE.sub("{uuid}", sanitize_incident_text(message, 1000))
    normalized = _NUMBER_RE.sub("{id}", normalized)
    return _WHITESPACE_RE.sub(" ", normalized).strip()[:500]


def create_error_fingerprint(
    *,
    service: str,
    exception_type: str,
    path: str,
    message: str,
) -> str:
    raw = "|".join(
        (
            service.strip().lower(),
            exception_type.strip(),
            path.strip(),
            normalize_error_message(message),
        )
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def incident_severity(*, status_code: int, category: str, occurrence_count: int = 1) -> str:
    if status_code >= 500 and category in {"db", "redis"}:
        return IncidentSeverity.P1
    if status_code >= 500:
        return IncidentSeverity.P1 if occurrence_count >= 5 else IncidentSeverity.P2
    return IncidentSeverity.P3


async def upsert_incident(
    session: AsyncSession,
    *,
    error_id: str,
    fingerprint: str,
    severity: str,
    status_code: int,
    service: str,
    environment: str,
    release_version: str | None,
    title: str,
    summary: str,
    trace_id: str | None,
    request_id: str | None,
    details: dict[str, Any] | None = None,
) -> SystemIncident:
    now = datetime.now(UTC)
    incident = await session.scalar(
        select(SystemIncident)
        .where(
            SystemIncident.fingerprint == fingerprint,
            SystemIncident.environment == environment,
            SystemIncident.status.in_(_ACTIVE_STATUSES),
        )
        .order_by(desc(SystemIncident.last_seen_at))
        .limit(1)
        .with_for_update()
    )
    if incident is None:
        incident = await session.scalar(
            select(SystemIncident)
            .where(
                SystemIncident.fingerprint == fingerprint,
                SystemIncident.environment == environment,
                SystemIncident.status == IncidentStatus.RESOLVED,
            )
            .order_by(desc(SystemIncident.last_seen_at))
            .limit(1)
            .with_for_update()
        )
    if incident is None:
        incident = SystemIncident(
            id=uuid4(),
            error_id=error_id,
            fingerprint=fingerprint,
            severity=severity,
            status=IncidentStatus.OPEN,
            service=service,
            environment=environment,
            release_version=release_version,
            title=title[:500],
            summary=summary[:2000],
            first_seen_at=now,
            last_seen_at=now,
            occurrence_count=1,
            trace_id=trace_id,
            request_id=request_id,
        )
        session.add(incident)
        await session.flush()
        event_type = "first_seen"
    else:
        incident.last_seen_at = now
        incident.occurrence_count += 1
        incident.severity = severity
        incident.release_version = release_version
        incident.trace_id = trace_id
        incident.request_id = request_id
        if incident.status == IncidentStatus.RESOLVED:
            incident.status = IncidentStatus.REGRESSION
            incident.resolved_at = None
            event_type = "regressed"
        else:
            event_type = "seen_again"

    session.add(
        SystemIncidentEvent(
            id=uuid4(),
            incident_id=incident.id,
            event_type=event_type,
            actor_type="system",
            details={
                **sanitize_incident_details(details or {}),
                "error_id": error_id,
                "status_code": status_code,
                "trace_id": trace_id,
                "request_id": request_id,
            },
        )
    )
    await session.flush()
    return incident


async def persist_error_incident(
    *,
    error_id: str,
    exception_type: str,
    message: str,
    path: str,
    status_code: int,
    category: str,
    trace_id: str | None,
    request_id: str | None,
    service: str | None = None,
    release_version: str | None = None,
    title: str | None = None,
    details: dict[str, Any] | None = None,
) -> SystemIncident | None:
    """Persist one server error without allowing incident storage to break a response."""
    if not settings.INCIDENT_DB_ENABLED:
        return None

    from api.core.database import AsyncSessionLocal

    service_name = service or settings.OTEL_SERVICE_NAME
    fingerprint = create_error_fingerprint(
        service=service_name,
        exception_type=exception_type,
        path=path,
        message=message,
    )
    async with AsyncSessionLocal() as session:
        try:
            result = await upsert_incident(
                session,
                error_id=error_id,
                fingerprint=fingerprint,
                severity=incident_severity(status_code=status_code, category=category),
                status_code=status_code,
                service=service_name,
                environment=settings.ENVIRONMENT,
                release_version=release_version or settings.APP_RELEASE or settings.APP_VERSION,
                title=title or f"{service_name}: {exception_type} at {path}",
                summary=normalize_error_message(message),
                trace_id=trace_id,
                request_id=request_id,
                details={"category": category, **(details or {})},
            )
            enqueue_auto_recovery = (
                settings.INCIDENT_AUTO_RECOVERY_ENABLED
                and category == "redis"
                and not result.automatic_recovery_attempted
            )
            if enqueue_auto_recovery:
                result.automatic_recovery_attempted = True
                result.recovery_action = "clear_cache:app"
            await session.commit()
            if enqueue_auto_recovery:
                current_app.send_task(
                    "api.services.incident_tasks.run_auto_recovery",
                    kwargs={
                        "incident_id": str(result.id),
                        "action": "clear_cache",
                        "target": "app",
                    },
                )
            return result
        except Exception:
            await session.rollback()
            logger.exception("Failed to persist incident error_id=%s", error_id)
            return None


async def persist_client_error_incident(
    *,
    error_id: str,
    message: str,
    stack: str,
    scope: str,
    path: str,
    context: dict[str, Any],
    trace_id: str | None,
    request_id: str | None,
    client_ip: str | None,
    user_agent: str | None,
) -> SystemIncident | None:
    """Persist browser failures beside API and Celery incidents for one operational timeline."""
    release = str(context.get("release") or "").strip() or None
    return await persist_error_incident(
        error_id=error_id,
        exception_type="ClientError",
        message=message,
        path=path or "unknown",
        status_code=0,
        category="client",
        trace_id=trace_id,
        request_id=request_id,
        service="web",
        release_version=release,
        title=f"web: {scope} at {path or 'unknown'}",
        details={
            "scope": scope,
            "stack_head": stack,
            "client_context": context,
            "client_ip": client_ip,
            "user_agent": user_agent,
        },
    )


async def auto_resolve_stale_incidents(
    session: AsyncSession,
    *,
    inactivity_hours: int,
    now: datetime | None = None,
) -> list[SystemIncident]:
    """Resolve unacknowledged incidents that have remained quiet for the configured window."""
    resolved_at = now or datetime.now(UTC)
    cutoff = resolved_at - timedelta(hours=max(1, inactivity_hours))
    incidents = list(
        (
            await session.scalars(
                select(SystemIncident)
                .where(
                    SystemIncident.status.in_(_AUTO_RESOLVABLE_STATUSES),
                    SystemIncident.last_seen_at < cutoff,
                )
                .order_by(SystemIncident.last_seen_at.asc())
                .limit(500)
                .with_for_update()
            )
        ).all()
    )
    for incident in incidents:
        incident.status = IncidentStatus.RESOLVED
        incident.resolved_at = resolved_at
        incident.resolution_note = (
            f"系統自動結案：已連續 {max(1, inactivity_hours)} 小時未再觀測到相同錯誤。"
        )
        await append_incident_event(
            session,
            incident_id=incident.id,
            event_type="auto_resolved",
            actor_id=None,
            details={
                "inactivity_hours": max(1, inactivity_hours),
                "last_seen_at": incident.last_seen_at.isoformat(),
                "resolved_at": resolved_at.isoformat(),
            },
        )
    return incidents


def incident_summary(incident: SystemIncident) -> dict[str, object]:
    """Return the operational fields safe for the observability list view."""
    return {
        "id": str(incident.id),
        "error_id": incident.error_id,
        "severity": incident.severity,
        "status": incident.status,
        "service": incident.service,
        "environment": incident.environment,
        "release_version": incident.release_version,
        "title": incident.title,
        "summary": incident.summary,
        "first_seen_at": incident.first_seen_at,
        "last_seen_at": incident.last_seen_at,
        "occurrence_count": incident.occurrence_count,
        "trace_id": incident.trace_id,
        "request_id": incident.request_id,
        "automatic_recovery_attempted": incident.automatic_recovery_attempted,
        "automatic_recovery_succeeded": incident.automatic_recovery_succeeded,
        "recovery_action": incident.recovery_action,
        "resolved_at": incident.resolved_at,
        "resolution_note": incident.resolution_note,
    }


async def list_incidents(
    session: AsyncSession,
    *,
    status: str | None = None,
    limit: int = 50,
) -> list[SystemIncident]:
    stmt = (
        select(SystemIncident)
        .order_by(desc(SystemIncident.last_seen_at))
        .limit(min(max(limit, 1), 200))
    )
    if status:
        stmt = stmt.where(SystemIncident.status == status)
    return list((await session.scalars(stmt)).all())


async def get_incident(session: AsyncSession, incident_id: UUID) -> SystemIncident | None:
    return await session.get(SystemIncident, incident_id)


async def list_incident_events(
    session: AsyncSession,
    incident_id: UUID,
    *,
    limit: int = 100,
) -> list[SystemIncidentEvent]:
    stmt = (
        select(SystemIncidentEvent)
        .where(SystemIncidentEvent.incident_id == incident_id)
        .order_by(desc(SystemIncidentEvent.created_at))
        .limit(min(max(limit, 1), 500))
    )
    return list((await session.scalars(stmt)).all())


async def export_incidents_csv(
    session: AsyncSession,
    *,
    status: str | None = None,
    limit: int = 1_000,
) -> str:
    """Build a spreadsheet-safe incident report including each incident's event timeline."""
    stmt = (
        select(SystemIncident)
        .order_by(desc(SystemIncident.last_seen_at))
        .limit(min(max(limit, 1), 1_000))
    )
    if status:
        stmt = stmt.where(SystemIncident.status == status)
    incidents = list((await session.scalars(stmt)).all())
    incident_ids = [incident.id for incident in incidents]
    events_by_incident: dict[UUID, list[dict[str, Any]]] = {
        incident_id: [] for incident_id in incident_ids
    }
    if incident_ids:
        events = list(
            (
                await session.scalars(
                    select(SystemIncidentEvent)
                    .where(SystemIncidentEvent.incident_id.in_(incident_ids))
                    .order_by(
                        SystemIncidentEvent.incident_id, SystemIncidentEvent.created_at.desc()
                    )
                )
            ).all()
        )
        for event in events:
            timeline = events_by_incident[event.incident_id]
            if len(timeline) < 50:
                timeline.append(
                    {
                        "created_at": event.created_at.isoformat(),
                        "event_type": event.event_type,
                        "actor_type": event.actor_type,
                        "actor_id": str(event.actor_id) if event.actor_id else None,
                        "details": event.details,
                    }
                )

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "incident_id",
            "error_id",
            "status",
            "severity",
            "service",
            "environment",
            "release_version",
            "title",
            "summary",
            "occurrence_count",
            "first_seen_at",
            "last_seen_at",
            "resolved_at",
            "trace_id",
            "request_id",
            "automatic_recovery_attempted",
            "automatic_recovery_succeeded",
            "recovery_action",
            "resolution_note",
            "event_timeline",
        ]
    )
    for incident in incidents:
        writer.writerow(
            [
                str(incident.id),
                incident.error_id,
                incident.status,
                incident.severity,
                incident.service,
                incident.environment,
                incident.release_version or "",
                incident.title,
                incident.summary or "",
                incident.occurrence_count,
                incident.first_seen_at.isoformat(),
                incident.last_seen_at.isoformat(),
                incident.resolved_at.isoformat() if incident.resolved_at else "",
                incident.trace_id or "",
                incident.request_id or "",
                incident.automatic_recovery_attempted,
                incident.automatic_recovery_succeeded,
                incident.recovery_action or "",
                incident.resolution_note or "",
                json.dumps(events_by_incident[incident.id], ensure_ascii=False),
            ]
        )
    return output.getvalue()


async def append_incident_event(
    session: AsyncSession,
    *,
    incident_id: UUID,
    event_type: str,
    actor_id: UUID | None,
    details: dict[str, Any] | None = None,
) -> SystemIncidentEvent:
    event = SystemIncidentEvent(
        id=uuid4(),
        incident_id=incident_id,
        event_type=event_type,
        actor_type="admin" if actor_id else "system",
        actor_id=actor_id,
        details=details or {},
    )
    session.add(event)
    await session.flush()
    return event
