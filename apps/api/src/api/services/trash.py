"""誤刪救援（trash）— MVP 版本。

本版只「列示」最近 N 天 audit_log 中的 delete 事件，**不**自行 restore，
因為各 entity 的還原需要 entity-specific 邏輯（外鍵恢復、唯一約束衝突、狀態機）。
UI 顯示「請聯絡工程師還原」並附 audit 紀錄細節，工程師再依 entity_type 與 meta
手動寫腳本還原。

未來如要做 1-click restore：
  - 為每張表加 deleted_at 欄位、改 destructive service 走 soft delete；
  - trash 表保留 7 天 grace；trash service 提供 restore endpoint。
本檔規格刻意先求穩定。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog

# 視為「刪除」的 action 關鍵字（大小寫無關）；額外可從 query 自訂
_DELETE_ACTION_LIKES: Sequence[str] = (
    "delete",
    "remove",
    "purge",
    "discard",
    "withdraw",
    "archive",  # 歸檔通常等於從活動列表「消失」
    "soft_delete",
)


@dataclass
class TrashEntry:
    audit_id: uuid.UUID
    entity_type: str
    entity_id: str
    action: str
    actor_id: str | None
    actor_email: str | None
    created_at: datetime
    summary: str | None
    meta: dict


async def list_recent_deletions(
    session: AsyncSession,
    *,
    days: int = 7,
    entity_type: str | None = None,
    limit: int = 200,
) -> list[TrashEntry]:
    """列出最近 N 天的「疑似刪除」事件。預設只看過去 7 天。"""
    cutoff = datetime.now(UTC) - timedelta(days=max(days, 1))
    stmt = (
        select(AuditLog)
        .where(AuditLog.created_at >= cutoff)
        .where(or_(*(AuditLog.action.ilike(f"%{kw}%") for kw in _DELETE_ACTION_LIKES)))
        .order_by(AuditLog.created_at.desc())
        .limit(min(max(limit, 1), 1000))
    )
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        TrashEntry(
            audit_id=r.id,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            action=r.action,
            actor_id=r.actor_id,
            actor_email=r.actor_email,
            created_at=r.created_at,
            summary=r.summary,
            meta=r.meta or {},
        )
        for r in rows
    ]


async def get_deletion(session: AsyncSession, audit_id: uuid.UUID) -> TrashEntry | None:
    row = await session.scalar(select(AuditLog).where(AuditLog.id == audit_id))
    if row is None:
        return None
    return TrashEntry(
        audit_id=row.id,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        action=row.action,
        actor_id=row.actor_id,
        actor_email=row.actor_email,
        created_at=row.created_at,
        summary=row.summary,
        meta=row.meta or {},
    )
