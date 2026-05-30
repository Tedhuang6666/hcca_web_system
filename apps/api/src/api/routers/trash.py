"""誤刪救援 router — /admin/trash

MVP：列出最近 N 天 audit_log 中的 delete 事件供管理員查證；
還原本身需 entity-specific 邏輯，目前不在此處執行。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services import trash as svc

router = APIRouter(prefix="/admin/trash", tags=["管理員 / 誤刪救援"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
TrashUser = Annotated[User, Depends(require_permission(PermissionCode.SYSTEM_TRASH_VIEW))]


class TrashEntryOut(BaseModel):
    audit_id: uuid.UUID
    entity_type: str
    entity_id: str
    action: str
    actor_id: str | None
    actor_email: str | None
    created_at: str
    summary: str | None
    meta: dict


@router.get("", response_model=list[TrashEntryOut], summary="列出近期刪除事件")
async def list_deletions(
    db: DbDep,
    _u: TrashUser,
    days: int = Query(7, ge=1, le=90),
    entity_type: str | None = Query(None, max_length=50),
    limit: int = Query(200, ge=1, le=1000),
) -> list[TrashEntryOut]:
    rows = await svc.list_recent_deletions(db, days=days, entity_type=entity_type, limit=limit)
    return [
        TrashEntryOut(
            audit_id=r.audit_id,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            action=r.action,
            actor_id=r.actor_id,
            actor_email=r.actor_email,
            created_at=r.created_at.isoformat(),
            summary=r.summary,
            meta=r.meta,
        )
        for r in rows
    ]


@router.get("/{audit_id}", response_model=TrashEntryOut, summary="某筆刪除事件詳情")
async def get_deletion(audit_id: uuid.UUID, db: DbDep, _u: TrashUser) -> TrashEntryOut:
    row = await svc.get_deletion(db, audit_id)
    if row is None:
        raise HTTPException(status_code=404, detail="找不到此事件")
    return TrashEntryOut(
        audit_id=row.audit_id,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        action=row.action,
        actor_id=row.actor_id,
        actor_email=row.actor_email,
        created_at=row.created_at.isoformat(),
        summary=row.summary,
        meta=row.meta,
    )
