"""網站漏洞與功能問題回報路由。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_optional_user
from api.dependencies.permissions import require_any
from api.models.site_report import SiteReport
from api.models.user import User
from api.schemas.site_report import (
    SiteReportCreate,
    SiteReportCreatedOut,
    SiteReportOut,
    SiteReportPortalOut,
    SiteReportUpdate,
)
from api.services import audit as audit_svc
from api.services import site_report as report_svc

router = APIRouter(prefix="/site-reports", tags=["網站回報"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
ReportManagerUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.SITE_REPORT_MANAGE,
            PermissionCode.SITE_MANAGE,
        )
    ),
]


@router.get(
    "/portal",
    response_model=SiteReportPortalOut,
    summary="取得網站回報表單設定",
)
async def get_report_portal() -> SiteReportPortalOut:
    return report_svc.get_portal()


@router.post(
    "",
    response_model=SiteReportCreatedOut,
    status_code=status.HTTP_201_CREATED,
    summary="送出網站漏洞或功能問題回報",
)
async def create_site_report(
    body: SiteReportCreate,
    db: DbDep,
    viewer: OptionalUser,
    user_agent: Annotated[str | None, Header()] = None,
) -> SiteReport:
    try:
        return await report_svc.create_report(
            db,
            body,
            viewer.id if viewer else None,
            user_agent=user_agent,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get(
    "/admin",
    response_model=list[SiteReportOut],
    summary="列出網站回報",
)
async def list_site_reports(
    db: DbDep,
    _: ReportManagerUser,
    status_filter: str | None = Query(None, alias="status", max_length=20),
    kind: str | None = Query(None, max_length=20),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[SiteReport]:
    return await report_svc.list_reports(
        db,
        status=status_filter,
        kind=kind,
        limit=limit,
        offset=offset,
    )


@router.patch(
    "/admin/{report_id}",
    response_model=SiteReportOut,
    summary="更新網站回報處理狀態",
)
async def update_site_report(
    report_id: uuid.UUID,
    body: SiteReportUpdate,
    db: DbDep,
    user: ReportManagerUser,
) -> SiteReport:
    report = await report_svc.get_report(db, report_id)
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這筆回報")
    updated = await report_svc.update_report(db, report, body, user.id)
    await audit_svc.record(
        db,
        entity_type="site_report",
        entity_id=str(updated.id),
        action="site_report.update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(mode="json"),
        summary="更新網站回報處理狀態",
    )
    return updated
