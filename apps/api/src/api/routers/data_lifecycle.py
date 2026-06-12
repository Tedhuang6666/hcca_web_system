"""資料生命週期 router — /admin/lifecycle

提供 dry-run 預覽、執行、規則清單、archive 檔列表與下載。
所有寫操作均寫 audit_log；archive 下載亦記錄 audit。
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services import audit as audit_svc
from api.services import data_lifecycle as svc

router = APIRouter(prefix="/admin/lifecycle", tags=["管理員 / 資料生命週期"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
LifecycleUser = Annotated[User, Depends(require_permission(PermissionCode.SYSTEM_LIFECYCLE))]


class RuleSummary(BaseModel):
    id: str
    label: str
    description: str
    default_retention_days: int
    min_retention_days: int
    default_action: str
    danger_level: str
    extra_filter: str | None = None
    affects_modules: list[str]
    matched_count: int


class PreviewBody(BaseModel):
    retention_days: int | None = Field(None, ge=1, le=10_000)


class PreviewOut(BaseModel):
    rule_id: str
    retention_days: int
    cutoff_at: str
    matched_count: int
    sample: list[dict[str, Any]]


class ExecuteBody(BaseModel):
    action: str | None = Field(None, pattern="^(archive|purge|archive_then_purge)$")
    retention_days: int | None = Field(None, ge=1, le=10_000)
    batch_size: int = Field(1000, ge=10, le=10_000)
    max_batches: int = Field(50, ge=1, le=500)


class ExecuteOut(BaseModel):
    rule_id: str
    action: str
    retention_days: int
    cutoff_at: str
    matched_count: int
    archived_count: int
    purged_count: int
    archive_file: str | None
    started_at: str
    finished_at: str


class ArchiveFileOut(BaseModel):
    path: str
    size_bytes: int
    modified_at: str


@router.get("/rules", response_model=list[RuleSummary], summary="列出規則與待清理筆數")
async def list_rules(db: DbDep, _u: LifecycleUser) -> list[RuleSummary]:
    rows = await svc.list_rules_with_counts(db)
    return [RuleSummary(**r) for r in rows]


@router.post(
    "/rules/{rule_id}/preview", response_model=PreviewOut, summary="Dry-run 預覽（不變更資料）"
)
async def preview_rule(rule_id: str, body: PreviewBody, db: DbDep, _u: LifecycleUser) -> PreviewOut:
    try:
        result = await svc.preview(db, rule_id=rule_id, retention_days=body.retention_days)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PreviewOut(
        rule_id=result.rule_id,
        retention_days=result.retention_days,
        cutoff_at=result.cutoff_at.isoformat(),
        matched_count=result.matched_count,
        sample=result.sample,
    )


@router.post("/rules/{rule_id}/execute", response_model=ExecuteOut, summary="實際執行清理")
async def execute_rule(
    rule_id: str, body: ExecuteBody, db: DbDep, user: LifecycleUser
) -> ExecuteOut:
    try:
        result = await svc.execute(
            db,
            rule_id=rule_id,
            action=body.action,  # type: ignore[arg-type]
            retention_days=body.retention_days,
            batch_size=body.batch_size,
            max_batches=body.max_batches,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await audit_svc.record(
        db,
        entity_type="data_lifecycle",
        entity_id=rule_id,
        action=f"lifecycle.{result.action}",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "rule_id": rule_id,
            "retention_days": result.retention_days,
            "matched_count": result.matched_count,
            "archived_count": result.archived_count,
            "purged_count": result.purged_count,
            "archive_file": result.archive_file,
            "started_at": result.started_at.isoformat(),
            "finished_at": result.finished_at.isoformat(),
        },
        summary=(
            f"資料生命週期 {result.action} 規則 {rule_id}："
            f"歸檔 {result.archived_count}、清除 {result.purged_count}"
        ),
    )

    return ExecuteOut(
        rule_id=result.rule_id,
        action=result.action,
        retention_days=result.retention_days,
        cutoff_at=result.cutoff_at.isoformat(),
        matched_count=result.matched_count,
        archived_count=result.archived_count,
        purged_count=result.purged_count,
        archive_file=result.archive_file,
        started_at=result.started_at.isoformat(),
        finished_at=result.finished_at.isoformat(),
    )


@router.get("/archives", response_model=list[ArchiveFileOut], summary="列出歸檔檔案")
async def list_archives(_u: LifecycleUser) -> list[ArchiveFileOut]:
    return [ArchiveFileOut(**f) for f in svc.list_archives()]


@router.get(
    "/archives/preview",
    response_model=list[dict],
    summary="預覽歸檔檔案前 N 行（含 metadata header）",
)
async def preview_archive(
    _u: LifecycleUser,
    path: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=500),
) -> list[dict]:
    try:
        return svc.read_archive(path, limit=limit)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="找不到歸檔檔") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/archives/download", summary="下載歸檔檔案", response_class=StreamingResponse)
async def download_archive(
    db: DbDep,
    user: LifecycleUser,
    path: str = Query(..., min_length=1),
) -> StreamingResponse:
    try:
        target = svc.resolve_archive_file(path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="找不到歸檔檔") from exc
    except OSError as exc:
        raise HTTPException(status_code=404, detail="找不到歸檔檔") from exc

    await audit_svc.record(
        db,
        entity_type="data_lifecycle",
        entity_id=path,
        action="lifecycle.archive_download",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"path": path, "size_bytes": target.stat().st_size},
        summary=f"下載歸檔檔：{path}",
    )

    def _iter():
        with target.open("rb") as fh:
            while chunk := fh.read(64 * 1024):
                yield chunk

    return StreamingResponse(
        _iter(),
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{target.name}"'},
    )
