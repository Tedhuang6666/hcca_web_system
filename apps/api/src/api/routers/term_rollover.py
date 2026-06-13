"""換屆精靈 router — /admin/term-rollover

提供 dry-run、execute（含 audit snapshot）、rollback。
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services import audit as audit_svc
from api.services import term_rollover as svc

router = APIRouter(prefix="/admin/term-rollover", tags=["管理員 / 換屆精靈"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
RolloverUser = Annotated[User, Depends(require_permission(PermissionCode.SYSTEM_TERM_ROLLOVER))]


# ── Schemas ─────────────────────────────────────────────────────────────


class NewAssignmentIn(BaseModel):
    user_id: uuid.UUID
    position_id: uuid.UUID
    start_date: date
    end_date: date | None = None


class DryRunBody(BaseModel):
    new_term_start: date
    new_assignments: list[NewAssignmentIn] = Field(default_factory=list)
    terminate_active_before: bool = True


class ExecuteBody(DryRunBody):
    confirm_token: str = Field(..., min_length=1)


class TerminationOut(BaseModel):
    user_position_id: uuid.UUID
    user_id: uuid.UUID
    user_email: str | None
    position_id: uuid.UUID
    position_name: str
    org_name: str
    current_end_date: date | None
    new_end_date: date


class AssignmentOut(BaseModel):
    user_id: uuid.UUID
    user_email: str | None
    position_id: uuid.UUID
    position_name: str
    org_name: str
    start_date: date
    end_date: date | None
    warning: str | None


class DryRunOut(BaseModel):
    new_term_start: date
    terminations: list[TerminationOut]
    new_assignments: list[AssignmentOut]
    warnings: list[str]
    summary: dict[str, int]


class ExecuteOut(BaseModel):
    batch_id: str
    terminated_count: int
    created_count: int
    started_at: str
    finished_at: str


class RollbackOut(BaseModel):
    batch_id: str
    restored_terminations: int
    deleted_new_assignments: int


def _to_assignments(items: list[NewAssignmentIn]) -> list[svc.NewAssignment]:
    return [
        svc.NewAssignment(
            user_id=a.user_id,
            position_id=a.position_id,
            start_date=a.start_date,
            end_date=a.end_date,
        )
        for a in items
    ]


# ── 端點 ───────────────────────────────────────────────────────────────


@router.post("/dry-run", response_model=DryRunOut, summary="預覽變更（不寫入）")
async def dry_run(body: DryRunBody, db: DbDep, _u: RolloverUser) -> DryRunOut:
    plan = await svc.dry_run(
        db,
        new_term_start=body.new_term_start,
        new_assignments=_to_assignments(body.new_assignments),
        terminate_active_before=body.terminate_active_before,
    )
    return DryRunOut(
        new_term_start=plan.new_term_start,
        terminations=[TerminationOut(**t.__dict__) for t in plan.terminations],
        new_assignments=[AssignmentOut(**a.__dict__) for a in plan.new_assignments],
        warnings=plan.warnings,
        summary=plan.summary,
    )


@router.post("/execute", response_model=ExecuteOut, summary="實際執行換屆")
async def execute_rollover(body: ExecuteBody, db: DbDep, user: RolloverUser) -> ExecuteOut:
    if body.confirm_token != "換屆":  # nosec B105
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="confirm_token 必須為「換屆」字串",
        )
    try:
        result, snapshot = await svc.execute(
            db,
            new_term_start=body.new_term_start,
            new_assignments=_to_assignments(body.new_assignments),
            terminate_active_before=body.terminate_active_before,
            actor_id=user.id,
            actor_email=user.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await audit_svc.record(
        db,
        entity_type="term_rollover",
        entity_id=result.batch_id,
        action="term_rollover.execute",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=snapshot,
        summary=(
            f"換屆執行 batch={result.batch_id}：結束 {result.terminated_count}、"
            f"新增 {result.created_count}"
        ),
    )

    return ExecuteOut(
        batch_id=result.batch_id,
        terminated_count=result.terminated_count,
        created_count=result.created_count,
        started_at=result.started_at.isoformat(),
        finished_at=result.finished_at.isoformat(),
    )


class RollbackBody(BaseModel):
    confirm_token: str = Field(..., min_length=1)


@router.post("/rollback/{batch_id}", response_model=RollbackOut, summary="復原某次換屆")
async def rollback_rollover(
    batch_id: str, body: RollbackBody, db: DbDep, user: RolloverUser
) -> RollbackOut:
    if body.confirm_token != "復原":  # nosec B105
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="confirm_token 必須為「復原」字串",
        )
    try:
        result: dict[str, Any] = await svc.rollback(db, batch_id=batch_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    await audit_svc.record(
        db,
        entity_type="term_rollover",
        entity_id=batch_id,
        action="term_rollover.rollback",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=result,
        summary=(
            f"換屆復原 batch={batch_id}：恢復 {result['restored_terminations']}、"
            f"刪除 {result['deleted_new_assignments']}"
        ),
    )

    return RollbackOut(
        batch_id=batch_id,
        restored_terminations=int(result["restored_terminations"]),
        deleted_new_assignments=int(result["deleted_new_assignments"]),
    )
