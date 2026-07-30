"""Incident fingerprinting, deduplication, and persistence."""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.system_incident import (
    IncidentSeverity,
    IncidentStatus,
    SystemIncident,
    SystemIncidentEvent,
)

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


def sanitize_incident_text(message: str, limit: int = 2000) -> str:
    sanitized = _SENSITIVE_RE.sub(r"\1[Filtered]", message)
    return sanitized[:limit]


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
        event_type = "seen_again"

    session.add(
        SystemIncidentEvent(
            id=uuid4(),
            incident_id=incident.id,
            event_type=event_type,
            actor_type="system",
            details={
                "error_id": error_id,
                "status_code": status_code,
                "trace_id": trace_id,
                "request_id": request_id,
                **(details or {}),
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
) -> SystemIncident | None:
    """Persist one server error without allowing incident storage to break a response."""
    if not settings.INCIDENT_DB_ENABLED:
        return None

    from api.core.database import AsyncSessionLocal

    fingerprint = create_error_fingerprint(
        service=settings.OTEL_SERVICE_NAME,
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
                service=settings.OTEL_SERVICE_NAME,
                environment=settings.ENVIRONMENT,
                release_version=settings.APP_RELEASE or settings.APP_VERSION,
                title=f"{settings.OTEL_SERVICE_NAME}: {exception_type} at {path}",
                summary=normalize_error_message(message),
                trace_id=trace_id,
                request_id=request_id,
                details={"category": category},
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
                from api.services.incident_tasks import run_auto_recovery

                run_auto_recovery.delay(
                    incident_id=str(result.id),
                    action="clear_cache",
                    target="app",
                )
            return result
        except Exception:
            await session.rollback()
            raise


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
