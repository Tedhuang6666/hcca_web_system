"""Celery tasks for durable incident persistence."""

from __future__ import annotations

import asyncio
import uuid

from celery import shared_task

from api.core.config import settings
from api.core.database import task_session
from api.services.incident import (
    append_incident_event,
    create_error_fingerprint,
    get_incident,
    incident_severity,
    normalize_error_message,
    sanitize_incident_text,
    upsert_incident,
)
from api.services.recovery_agent import execute_recovery


async def _persist_background_incident(
    *,
    task_name: str,
    task_id: str | None,
    exception_type: str,
    message: str,
    traceback_text: str,
    trace_id: str | None,
) -> None:
    fingerprint = create_error_fingerprint(
        service="celery",
        exception_type=exception_type,
        path=f"celery://{task_name}",
        message=message,
    )
    async with task_session() as session:
        await upsert_incident(
            session,
            error_id=task_id or f"celery-{uuid.uuid4().hex[:12]}",
            fingerprint=fingerprint,
            severity=incident_severity(status_code=500, category="celery"),
            status_code=500,
            service="celery",
            environment=settings.ENVIRONMENT,
            release_version=settings.APP_RELEASE or settings.APP_VERSION,
            title=f"celery: {exception_type} in {task_name}",
            summary=normalize_error_message(message),
            trace_id=trace_id,
            request_id=task_id,
            details={
                "task_name": task_name,
                "task_id": task_id,
                "traceback_head": sanitize_incident_text(traceback_text),
            },
        )
        await session.commit()


async def _run_auto_recovery(
    *,
    incident_id: str,
    action: str,
    target: str,
) -> None:
    async with task_session() as session:
        from uuid import UUID

        incident = await get_incident(session, UUID(incident_id))
        if incident is None:
            return
        if action != "clear_cache" or target != "app":
            return
        result = await execute_recovery(action="clear_cache", target="app")
        incident.automatic_recovery_succeeded = result.success
        await append_incident_event(
            session,
            incident_id=incident.id,
            event_type="automatic_recovery",
            actor_id=None,
            details={
                "action": result.action,
                "target": result.target,
                "success": result.success,
                "detail": result.detail,
            },
        )
        if result.success:
            incident.status = "mitigated"
        await session.commit()


@shared_task(
    name="api.services.incident_tasks.persist_background_incident",
    ignore_result=True,
)
def persist_background_incident(
    *,
    task_name: str,
    task_id: str | None,
    exception_type: str,
    message: str,
    traceback_text: str = "",
    trace_id: str | None = None,
) -> None:
    if not settings.INCIDENT_DB_ENABLED:
        return
    asyncio.run(
        _persist_background_incident(
            task_name=task_name,
            task_id=task_id,
            exception_type=exception_type,
            message=message,
            traceback_text=traceback_text,
            trace_id=trace_id,
        )
    )


@shared_task(
    name="api.services.incident_tasks.run_auto_recovery",
    ignore_result=True,
)
def run_auto_recovery(*, incident_id: str, action: str, target: str) -> None:
    asyncio.run(
        _run_auto_recovery(
            incident_id=incident_id,
            action=action,
            target=target,
        )
    )


__all__ = ["persist_background_incident", "run_auto_recovery"]
