"""稽核日誌 service — 寫入 AuditLog，呼叫端無需關心細節"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog


async def record(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_id: str | None = None,
    actor_email: str | None = None,
    meta: dict[str, Any] | None = None,
    ip_address: str | None = None,
    summary: str | None = None,
) -> AuditLog:
    """寫入一筆不可變稽核日誌，立即 flush（不 commit，由呼叫端事務決定）。"""
    log = AuditLog(
        entity_type=entity_type,
        entity_id=str(entity_id),
        action=action,
        actor_id=str(actor_id) if actor_id else None,
        actor_email=actor_email,
        meta=meta or {},
        ip_address=ip_address,
        created_at=datetime.now(UTC),
        summary=summary,
    )
    session.add(log)
    await session.flush()
    return log
