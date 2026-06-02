"""數據分析路由 - 公文效率統計、部門排名、公告參與率"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any, require_permission
from api.models.announcement import Announcement, AnnouncementRead
from api.models.document import Document, DocumentApproval
from api.models.org import Org
from api.models.survey import Survey, SurveyResponse, SurveyStatus

router = APIRouter(prefix="/analytics", tags=["數據分析"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


class DocumentEfficiencyOut(BaseModel):
    avg_processing_hours: float | None
    total_documents: int
    completed_documents: int
    overdue_count: int
    overdue_rate: float


class DeptRankingItem(BaseModel):
    org_id: uuid.UUID
    org_name: str
    avg_processing_hours: float | None
    total_docs: int


class PendingAlertItem(BaseModel):
    approval_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    step_order: int
    waiting_hours: float


class AnnouncementParticipationItem(BaseModel):
    announcement_id: uuid.UUID
    title: str
    reader_count: int
    published_at: datetime | None


class SurveyParticipationItem(BaseModel):
    survey_id: uuid.UUID
    title: str
    response_count: int
    status: str
    created_at: datetime


# ── 公文效率統計 ───────────────────────────────────────────────────────────────


@router.get(
    "/documents/efficiency",
    response_model=DocumentEfficiencyOut,
    summary="公文效率統計總覽",
)
async def document_efficiency(
    db: DbDep,
    _: Annotated[
        object, Depends(require_any(PermissionCode.ANALYTICS_VIEW, PermissionCode.ADMIN_ALL))
    ],
    org_id: uuid.UUID | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> DocumentEfficiencyOut:
    base = select(Document)
    if org_id:
        base = base.where(Document.org_id == org_id)
    if date_from:
        base = base.where(Document.submitted_at >= date_from)
    if date_to:
        base = base.where(Document.submitted_at <= date_to)

    total = await db.scalar(select(func.count()).select_from(base.subquery()))

    completed_q = base.where(Document.completed_at.isnot(None))
    completed = await db.scalar(select(func.count()).select_from(completed_q.subquery()))

    avg_seconds = await db.scalar(
        select(
            func.avg(func.extract("epoch", Document.completed_at - Document.submitted_at))
        ).select_from(completed_q.subquery())
    )
    avg_hours = float(avg_seconds) / 3600 if avg_seconds else None

    overdue = await db.scalar(
        select(func.count()).select_from(
            base.where(
                Document.due_date.isnot(None),
                Document.completed_at.is_(None),
                Document.due_date < func.now(),
            ).subquery()
        )
    )
    overdue_rate = float(overdue or 0) / float(total) if total else 0.0

    return DocumentEfficiencyOut(
        avg_processing_hours=avg_hours,
        total_documents=int(total or 0),
        completed_documents=int(completed or 0),
        overdue_count=int(overdue or 0),
        overdue_rate=overdue_rate,
    )


@router.get(
    "/documents/dept-ranking",
    response_model=list[DeptRankingItem],
    summary="部門公文處理時效排名",
)
async def dept_ranking(
    db: DbDep,
    _: Annotated[
        object, Depends(require_any(PermissionCode.ANALYTICS_VIEW, PermissionCode.ADMIN_ALL))
    ],
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> list[DeptRankingItem]:
    q = (
        select(
            Document.org_id,
            Org.name.label("org_name"),
            func.count(Document.id).label("total_docs"),
            func.avg(func.extract("epoch", Document.completed_at - Document.submitted_at)).label(
                "avg_seconds"
            ),
        )
        .join(Org, Org.id == Document.org_id)
        .where(Document.submitted_at.isnot(None))
        .group_by(Document.org_id, Org.name)
        .order_by(func.avg(func.extract("epoch", Document.completed_at - Document.submitted_at)))
    )
    if date_from:
        q = q.where(Document.submitted_at >= date_from)
    if date_to:
        q = q.where(Document.submitted_at <= date_to)

    rows = (await db.execute(q)).all()
    return [
        DeptRankingItem(
            org_id=row.org_id,
            org_name=row.org_name,
            avg_processing_hours=float(row.avg_seconds) / 3600 if row.avg_seconds else None,
            total_docs=row.total_docs,
        )
        for row in rows
    ]


@router.get(
    "/documents/pending-alerts",
    response_model=list[PendingAlertItem],
    summary="超時待簽核警告列表",
)
async def pending_alerts(
    db: DbDep,
    _: Annotated[object, Depends(require_permission(PermissionCode.DOCUMENT_ADMIN))],
    threshold_hours: float = Query(48, gt=0, description="超過幾小時視為超時"),
) -> list[PendingAlertItem]:
    from api.models.document import ApprovalStepStatus

    threshold_seconds = threshold_hours * 3600
    q = (
        select(
            DocumentApproval.id,
            DocumentApproval.document_id,
            Document.title.label("document_title"),
            DocumentApproval.step_order,
            func.extract("epoch", func.now() - DocumentApproval.created_at).label(
                "waiting_seconds"
            ),
        )
        .join(Document, Document.id == DocumentApproval.document_id)
        .where(DocumentApproval.status == ApprovalStepStatus.PENDING)
        .where(func.extract("epoch", func.now() - DocumentApproval.created_at) > threshold_seconds)
        .order_by(func.extract("epoch", func.now() - DocumentApproval.created_at).desc())
    )
    rows = (await db.execute(q)).all()
    return [
        PendingAlertItem(
            approval_id=row.id,
            document_id=row.document_id,
            document_title=row.document_title,
            step_order=row.step_order,
            waiting_hours=float(row.waiting_seconds) / 3600,
        )
        for row in rows
    ]


# ── 公告參與率統計 ─────────────────────────────────────────────────────────────


@router.get(
    "/announcements/participation",
    response_model=list[AnnouncementParticipationItem],
    summary="公告閱讀參與率總覽",
)
async def announcement_participation(
    db: DbDep,
    _: Annotated[
        object, Depends(require_any(PermissionCode.ANALYTICS_VIEW, PermissionCode.ADMIN_ALL))
    ],
    org_id: uuid.UUID | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> list[AnnouncementParticipationItem]:
    q = (
        select(
            Announcement.id,
            Announcement.title,
            Announcement.published_at,
            func.count(AnnouncementRead.id).label("reader_count"),
        )
        .outerjoin(AnnouncementRead, AnnouncementRead.announcement_id == Announcement.id)
        .where(Announcement.is_published == True)  # noqa: E712
        .group_by(Announcement.id, Announcement.title, Announcement.published_at)
        .order_by(func.count(AnnouncementRead.id).desc())
        .limit(limit)
    )
    if org_id:
        q = q.where(Announcement.org_id == org_id)
    if date_from:
        q = q.where(Announcement.published_at >= date_from)
    if date_to:
        q = q.where(Announcement.published_at <= date_to)

    rows = (await db.execute(q)).all()
    return [
        AnnouncementParticipationItem(
            announcement_id=row.id,
            title=row.title,
            reader_count=row.reader_count,
            published_at=row.published_at,
        )
        for row in rows
    ]


# ── 問卷回應率統計 ─────────────────────────────────────────────────────────────


@router.get(
    "/surveys/participation",
    response_model=list[SurveyParticipationItem],
    summary="問卷回應率統計",
)
async def survey_participation(
    db: DbDep,
    _: Annotated[
        object, Depends(require_any(PermissionCode.ANALYTICS_VIEW, PermissionCode.ADMIN_ALL))
    ],
    org_id: uuid.UUID | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
) -> list[SurveyParticipationItem]:
    q = (
        select(
            Survey.id,
            Survey.title,
            Survey.status,
            Survey.created_at,
            func.count(SurveyResponse.id).label("response_count"),
        )
        .outerjoin(SurveyResponse, SurveyResponse.survey_id == Survey.id)
        .where(Survey.status != SurveyStatus.DRAFT)
        .group_by(Survey.id, Survey.title, Survey.status, Survey.created_at)
        .order_by(func.count(SurveyResponse.id).desc())
        .limit(limit)
    )
    if org_id:
        q = q.where(Survey.org_id == org_id)
    if date_from:
        q = q.where(Survey.created_at >= date_from)
    if date_to:
        q = q.where(Survey.created_at <= date_to)

    rows = (await db.execute(q)).all()
    return [
        SurveyParticipationItem(
            survey_id=row.id,
            title=row.title,
            response_count=row.response_count,
            status=row.status,
            created_at=row.created_at,
        )
        for row in rows
    ]
