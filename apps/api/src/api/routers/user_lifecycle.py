"""使用者學籍 / 帳號生命週期 router — /admin/users/{user_id}/lifecycle"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services import audit as audit_svc
from api.services import user_lifecycle as svc

router = APIRouter(prefix="/admin/users", tags=["管理員 / 學籍異動"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
LifecycleUser = Annotated[User, Depends(require_permission(PermissionCode.SYSTEM_USER_LIFECYCLE))]


class LifecycleActionBody(BaseModel):
    reason: str = Field("", max_length=500)


class LifecycleResultOut(BaseModel):
    user_id: uuid.UUID
    action: str
    affected_positions: int
    was_active: bool
    performed_at: str


class StatusOut(BaseModel):
    user_id: str
    email: str
    display_name: str
    is_active: bool
    active_positions: list[dict]


@router.get(
    "/{user_id}/lifecycle/status",
    response_model=StatusOut,
    summary="查看當前帳號狀態與在任職位",
)
async def get_status(user_id: uuid.UUID, db: DbDep, _u: LifecycleUser) -> StatusOut:
    try:
        snapshot = await svc.get_status(db, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return StatusOut(**snapshot)


async def _run_action(
    db: AsyncSession,
    requester: User,
    user_id: uuid.UUID,
    action: str,
    body: LifecycleActionBody,
) -> LifecycleResultOut:
    fn = {
        "freeze": svc.freeze,
        "archive_alumni": svc.archive_alumni,
        "restore": svc.restore,
    }[action]
    try:
        result = await fn(db, user_id=user_id, reason=body.reason)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await audit_svc.record(
        db,
        entity_type="user_lifecycle",
        entity_id=str(user_id),
        action=f"user_lifecycle.{action}",
        actor_id=str(requester.id),
        actor_email=requester.email,
        meta={
            "reason": body.reason,
            "affected_positions": result.affected_positions,
            "was_active": result.was_active,
            "snapshot": result.snapshot,
        },
        summary=f"學籍異動 {action} user={user_id} 影響 {result.affected_positions} 個任期",
    )
    return LifecycleResultOut(
        user_id=result.user_id,
        action=result.action,
        affected_positions=result.affected_positions,
        was_active=result.was_active,
        performed_at=result.performed_at.isoformat(),
    )


@router.post(
    "/{user_id}/lifecycle/freeze",
    response_model=LifecycleResultOut,
    summary="凍結帳號（停所有任期 + is_active=false）",
)
async def freeze_user(
    user_id: uuid.UUID, body: LifecycleActionBody, db: DbDep, requester: LifecycleUser
) -> LifecycleResultOut:
    return await _run_action(db, requester, user_id, "freeze", body)


@router.post(
    "/{user_id}/lifecycle/archive-alumni",
    response_model=LifecycleResultOut,
    summary="校友歸檔（凍結 + display_name 加「（校友）」標記）",
)
async def archive_alumni(
    user_id: uuid.UUID, body: LifecycleActionBody, db: DbDep, requester: LifecycleUser
) -> LifecycleResultOut:
    return await _run_action(db, requester, user_id, "archive_alumni", body)


@router.post(
    "/{user_id}/lifecycle/restore",
    response_model=LifecycleResultOut,
    summary="解凍（恢復 is_active；不重建已結束任期）",
)
async def restore_user(
    user_id: uuid.UUID, body: LifecycleActionBody, db: DbDep, requester: LifecycleUser
) -> LifecycleResultOut:
    return await _run_action(db, requester, user_id, "restore", body)
