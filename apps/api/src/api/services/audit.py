"""稽核日誌 service — 寫入 AuditLog，呼叫端無需關心細節"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


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

    # ── 治理事件總線橋接 ────────────────────────────────────────────────
    # audit 幾乎涵蓋全平台每個狀態變化，因此把「治理中樞會關心的」生命週期動作
    # 從這唯一入口灌入治理匯流，讓每個模組都自動為事情服務（不必各模組手寫 ingest）。
    # 非登錄動作＝一次 dict 查詢 miss（近零成本）；登錄動作以 savepoint 隔離，
    # 治理錯誤絕不影響稽核本身。
    await _bridge_to_governance(
        session,
        entity_type=entity_type,
        entity_id=str(entity_id),
        action=action,
        actor_id=actor_id,
        actor_email=actor_email,
        summary=summary,
        meta=meta,
    )
    return log


async def _bridge_to_governance(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_id: str | None = None,
    actor_email: str | None = None,
    summary: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    # 延遲 import 避免循環依賴（governance_ingest 依賴眾多 service）。
    from api.services import governance_events, governance_ingest

    spec = governance_events.lookup(entity_type, action)
    if spec is None:
        return
    try:
        source_uuid = uuid.UUID(entity_id)
    except (ValueError, AttributeError):
        return  # 登錄實體的 id 必為 UUID；非 UUID 略過

    actor_uuid: uuid.UUID | None = None
    if actor_id:
        try:
            actor_uuid = uuid.UUID(str(actor_id))
        except ValueError:
            actor_uuid = None

    await governance_ingest.safe_ingest(
        session,
        event_type=spec.event_type,
        actor_id=actor_uuid,
        actor_email=actor_email,
        source_type=spec.source_type,
        source_id=source_uuid,
        title=summary or spec.label,
        href=governance_events.href_for(spec.source_type, entity_id),
        summary=summary,
        payload=dict(meta or {}),
    )
