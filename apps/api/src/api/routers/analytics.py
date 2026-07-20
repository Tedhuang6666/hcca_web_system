"""數據分析路由 - 公文效率統計、部門排名、公告參與率"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any, require_permission
from api.models.announcement import Announcement, AnnouncementRead
from api.models.document import ApprovalStepStatus, Document, DocumentApproval
from api.models.org import Org
from api.models.petition import PetitionCase, PetitionStatus
from api.models.regulation import Regulation, RegulationWorkflowStatus
from api.models.survey import Survey, SurveyResponse, SurveyStatus
from api.models.user import User
from api.schemas.analytics import PageViewCreate, ProductAnalyticsOut
from api.services.analytics import get_product_analytics, record_page_view

router = APIRouter(prefix="/analytics", tags=["數據分析"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


def _epoch_seconds(db: AsyncSession, later: object, earlier: object):
    """Return a portable SQL expression for the duration between two timestamps."""
    if db.get_bind().dialect.name == "sqlite":
        return (func.julianday(later) - func.julianday(earlier)) * 86400
    return func.extract("epoch", later - earlier)


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


InsightSeverity = Literal["info", "warning", "critical"]


class InsightItem(BaseModel):
    id: str
    module: str
    title: str
    description: str
    severity: InsightSeverity
    score: int
    href: str
    reason: str
    recommended_action: str
    created_at: datetime


class AnalyticsInsightsOut(BaseModel):
    items: list[InsightItem]
    total: int


@router.post("/page-views", status_code=204, summary="記錄目前使用者的頁面瀏覽")
async def create_page_view(body: PageViewCreate, db: DbDep, current_user: CurrentUser) -> None:
    await record_page_view(db, current_user.id, body.path)
    await db.commit()


@router.get("/product", response_model=ProductAnalyticsOut, summary="平台產品使用統計")
async def product_analytics(
    db: DbDep,
    _: Annotated[
        object, Depends(require_any(PermissionCode.ANALYTICS_VIEW, PermissionCode.ADMIN_ALL))
    ],
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
) -> ProductAnalyticsOut:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="起始日期不得晚於結束日期")
    return await get_product_analytics(db, date_from, date_to)


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

    completed_subquery = completed_q.subquery()
    duration_expr = _epoch_seconds(
        db, completed_subquery.c.completed_at, completed_subquery.c.submitted_at
    )
    avg_seconds = await db.scalar(select(func.avg(duration_expr)))
    avg_hours = round(float(avg_seconds) / 3600, 6) if avg_seconds else None

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
    duration_expr = _epoch_seconds(db, Document.completed_at, Document.submitted_at)
    q = (
        select(
            Document.org_id,
            Org.name.label("org_name"),
            func.count(Document.id).label("total_docs"),
            func.avg(duration_expr).label("avg_seconds"),
        )
        .join(Org, Org.id == Document.org_id)
        .where(Document.submitted_at.isnot(None))
        .group_by(Document.org_id, Org.name)
        .order_by(func.avg(duration_expr))
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
    waiting_expr = _epoch_seconds(db, func.now(), DocumentApproval.created_at)
    q = (
        select(
            DocumentApproval.id,
            DocumentApproval.document_id,
            Document.title.label("document_title"),
            DocumentApproval.step_order,
            waiting_expr.label("waiting_seconds"),
        )
        .join(Document, Document.id == DocumentApproval.document_id)
        .where(DocumentApproval.status == ApprovalStepStatus.PENDING)
        .where(waiting_expr > threshold_seconds)
        .order_by(waiting_expr.desc())
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


@router.get(
    "/insights",
    response_model=AnalyticsInsightsOut,
    summary="治理異常洞察與優先處理建議",
)
async def governance_insights(
    db: DbDep,
    _: Annotated[
        object, Depends(require_any(PermissionCode.ANALYTICS_VIEW, PermissionCode.ADMIN_ALL))
    ],
    limit: int = Query(20, ge=1, le=50),
) -> AnalyticsInsightsOut:
    now = datetime.now(UTC)
    items: list[InsightItem] = []

    pending_wait_expr = _epoch_seconds(db, func.now(), DocumentApproval.created_at)
    pending_rows = (
        await db.execute(
            select(
                DocumentApproval.id,
                DocumentApproval.document_id,
                Document.title,
                Document.serial_number,
                DocumentApproval.step_order,
                pending_wait_expr.label("waiting_seconds"),
            )
            .join(Document, Document.id == DocumentApproval.document_id)
            .where(DocumentApproval.status == ApprovalStepStatus.PENDING)
            .where(pending_wait_expr > 48 * 3600)
            .order_by(pending_wait_expr.desc())
            .limit(8)
        )
    ).all()
    for row in pending_rows:
        waiting_hours = float(row.waiting_seconds or 0) / 3600
        severity: InsightSeverity = "critical" if waiting_hours >= 96 else "warning"
        items.append(
            InsightItem(
                id=f"document-bottleneck:{row.id}",
                module="document",
                title=f"公文簽核可能卡關：{row.title}",
                description=f"第 {row.step_order} 關已等待 {waiting_hours:.1f} 小時。",
                severity=severity,
                score=95 if severity == "critical" else 78,
                href=f"/documents/{row.serial_number or row.document_id}",
                reason="待簽核時間超過 48 小時",
                recommended_action="聯繫簽核人或指派代理人推進流程",
                created_at=now,
            )
        )

    workload_count_expr = func.count(DocumentApproval.id)
    workload_rows = (
        await db.execute(
            select(
                DocumentApproval.approver_id,
                User.display_name,
                User.email,
                workload_count_expr.label("pending_count"),
            )
            .join(User, User.id == DocumentApproval.approver_id)
            .where(DocumentApproval.status == ApprovalStepStatus.PENDING)
            .group_by(DocumentApproval.approver_id, User.display_name, User.email)
            .having(workload_count_expr >= 6)
            .order_by(workload_count_expr.desc())
            .limit(5)
        )
    ).all()
    for row in workload_rows:
        name = row.display_name or row.email or str(row.approver_id)
        count = int(row.pending_count or 0)
        items.append(
            InsightItem(
                id=f"document-workload:{row.approver_id}",
                module="document",
                title=f"簽核負載集中：{name}",
                description=f"目前有 {count} 件公文等待同一人處理。",
                severity="warning",
                score=min(70 + count * 2, 92),
                href="/analytics",
                reason="同一簽核人待辦量偏高",
                recommended_action="檢查是否需要代理、分流或提醒",
                created_at=now,
            )
        )

    delayed_regs = (
        await db.execute(
            select(Regulation)
            .where(Regulation.workflow_status == RegulationWorkflowStatus.COUNCIL_APPROVED)
            .where(Regulation.updated_at < now - timedelta(hours=72))
            .order_by(Regulation.updated_at.asc())
            .limit(5)
        )
    ).scalars()
    for reg in delayed_regs:
        items.append(
            InsightItem(
                id=f"regulation-publish-delay:{reg.id}",
                module="regulation",
                title=f"法規公布延遲：{reg.title}",
                description="已議會核定超過 72 小時，尚未完成主席公布。",
                severity="critical",
                score=94,
                href=f"/regulations/{reg.id}",
                reason="核定後長時間未公布",
                recommended_action="確認公布令與法規版本後完成公布",
                created_at=now,
            )
        )

    stale_petitions = (
        await db.execute(
            select(PetitionCase)
            .where(PetitionCase.status == PetitionStatus.NEEDS_INFO)
            .where(PetitionCase.updated_at < now - timedelta(hours=72))
            .order_by(PetitionCase.updated_at.asc())
            .limit(5)
        )
    ).scalars()
    for petition in stale_petitions:
        items.append(
            InsightItem(
                id=f"petition-needs-info:{petition.id}",
                module="petition",
                title=f"陳情補件追蹤：{petition.title}",
                description="案件停在補充資料狀態超過 72 小時。",
                severity="warning",
                score=72,
                href=f"/petitions/{petition.case_number}",
                reason="補件狀態停留過久",
                recommended_action="提醒當事人補件，或更新承辦狀態",
                created_at=now,
            )
        )

    low_read_announcements = (
        await db.execute(
            select(
                Announcement.id,
                Announcement.title,
                Announcement.published_at,
                func.count(AnnouncementRead.id).label("reader_count"),
            )
            .outerjoin(AnnouncementRead, AnnouncementRead.announcement_id == Announcement.id)
            .where(Announcement.is_published == True)  # noqa: E712
            .where(Announcement.published_at.is_not(None))
            .where(Announcement.published_at < now - timedelta(hours=24))
            .group_by(Announcement.id, Announcement.title, Announcement.published_at)
            .having(func.count(AnnouncementRead.id) <= 2)
            .order_by(Announcement.published_at.desc())
            .limit(5)
        )
    ).all()
    for ann in low_read_announcements:
        items.append(
            InsightItem(
                id=f"announcement-low-read:{ann.id}",
                module="announcement",
                title=f"公告閱讀偏低：{ann.title}",
                description=f"發布超過 24 小時，目前僅 {ann.reader_count} 次閱讀。",
                severity="info",
                score=52,
                href=f"/announcements/{ann.id}",
                reason="發布後閱讀數偏低",
                recommended_action="檢查受眾、置頂或補發通知",
                created_at=now,
            )
        )

    low_response_surveys = (
        await db.execute(
            select(
                Survey.id,
                Survey.title,
                Survey.created_at,
                func.count(SurveyResponse.id).label("response_count"),
            )
            .outerjoin(SurveyResponse, SurveyResponse.survey_id == Survey.id)
            .where(Survey.status == SurveyStatus.OPEN)
            .where(Survey.created_at < now - timedelta(hours=48))
            .group_by(Survey.id, Survey.title, Survey.created_at)
            .having(func.count(SurveyResponse.id) <= 3)
            .order_by(Survey.created_at.asc())
            .limit(5)
        )
    ).all()
    for survey in low_response_surveys:
        items.append(
            InsightItem(
                id=f"survey-low-response:{survey.id}",
                module="survey",
                title=f"問卷回應偏低：{survey.title}",
                description=f"開放超過 48 小時，目前僅 {survey.response_count} 份回應。",
                severity="info",
                score=50,
                href=f"/surveys/{survey.id}",
                reason="開放後回應數偏低",
                recommended_action="調整公告位置或補發提醒",
                created_at=now,
            )
        )

    items.sort(key=lambda item: (-item.score, item.module, item.title))
    return AnalyticsInsightsOut(items=items[:limit], total=len(items))


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
