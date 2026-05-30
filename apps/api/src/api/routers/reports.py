"""預寫常用報表 router — /admin/reports"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services import reports as svc

router = APIRouter(prefix="/admin/reports", tags=["管理員 / 預寫報表"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReportsUser = Annotated[User, Depends(require_permission(PermissionCode.SYSTEM_REPORTS))]


class ReportSummary(BaseModel):
    id: str
    label: str
    description: str


class ReportResult(BaseModel):
    id: str
    label: str
    rows: list[dict[str, Any]]
    row_count: int


@router.get("", response_model=list[ReportSummary], summary="列出所有可用報表")
async def list_reports(_u: ReportsUser) -> list[ReportSummary]:
    return [ReportSummary(id=r.id, label=r.label, description=r.description) for r in svc.REPORTS]


@router.get("/{report_id}", response_model=ReportResult, summary="執行報表")
async def run_report(report_id: str, db: DbDep, _u: ReportsUser) -> ReportResult:
    try:
        spec = svc.get_report(report_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        rows = await svc.run_report(db, report_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"報表執行失敗：{type(exc).__name__}") from exc
    return ReportResult(id=spec.id, label=spec.label, rows=rows, row_count=len(rows))


@router.get("/{report_id}/csv", summary="報表 CSV 匯出", response_class=StreamingResponse)
async def export_report_csv(report_id: str, db: DbDep, _u: ReportsUser) -> StreamingResponse:
    try:
        spec = svc.get_report(report_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        rows = await svc.run_report(db, report_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"報表執行失敗：{type(exc).__name__}") from exc
    data = svc.to_csv(rows)

    def _iter():
        yield data

    return StreamingResponse(
        _iter(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="report_{spec.id}.csv"'},
    )
