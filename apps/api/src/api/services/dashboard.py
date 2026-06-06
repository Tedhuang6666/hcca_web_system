"""儀表板聚合 service：依角色組合 widgets，每個 widget 失敗時自動降級。

設計原則：
- 各 widget builder 互相獨立，使用 asyncio.gather 並行。
- 單一 builder 失敗只記 warning，不影響其他 widget。
- 每個 builder 回傳 DashboardWidget 或 None（None 表示不顯示）。
- 不寫業務邏輯，只是「拿既有資料彙整成 widget 卡片」。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.announcement import Announcement
from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
    DocumentStatus,
)
from api.models.meeting import (
    AttendanceStatus,
    Meeting,
    MeetingAttendance,
    MeetingStatus,
)
from api.models.petition import PetitionCase, PetitionStatus
from api.models.regulation import Regulation, RegulationWorkflowStatus
from api.models.survey import Survey, SurveyStatus
from api.models.user import User
from api.schemas.dashboard import (
    DashboardResponse,
    DashboardWidget,
    DashboardWidgetItem,
    LayoutHint,
)
from api.services.permission import get_user_permission_codes
from api.services.task_priority import prioritize_dashboard_widgets

logger = logging.getLogger(__name__)


# ── helpers ──────────────────────────────────────────────────────────────────


def _is_leader(perms: frozenset[str], is_admin: bool) -> bool:
    if is_admin:
        return True
    return any(
        code in perms
        for code in (
            "admin:all",
            "president:publish",
            "regulation:council_approve",
            "regulation:schedule",
        )
    )


def _is_officer(perms: frozenset[str]) -> bool:
    return any(
        code in perms
        for code in (
            "document:create",
            "regulation:create",
            "class:shop_collect",
            "class:meal_collect",
        )
    ) or any(code.startswith("petition:") for code in perms)


def _layout_hint(perms: frozenset[str], is_admin: bool) -> LayoutHint:
    if _is_leader(perms, is_admin):
        return "leader"
    if _is_officer(perms):
        return "officer"
    return "student"


def _has(perms: frozenset[str], is_admin: bool, code: str) -> bool:
    if is_admin or "admin:all" in perms:
        return True
    if code.endswith(":*"):
        prefix = code[:-1]
        return any(p.startswith(prefix) for p in perms)
    return code in perms


def _decorate_item_priority(
    item: DashboardWidgetItem,
    *,
    base_score: int,
    reason: str,
    action: str,
) -> DashboardWidgetItem:
    item.priority_score = min(base_score, 100)
    item.priority_reasons = [reason]
    item.recommended_action = action
    return item


# ── widget builders ──────────────────────────────────────────────────────────


async def _w_doc_draft(db: AsyncSession, user: User) -> DashboardWidget | None:
    count = await db.scalar(
        select(func.count(Document.id))
        .where(Document.created_by == user.id)
        .where(Document.status == DocumentStatus.DRAFT)
    )
    count = int(count or 0)
    if count == 0:
        return None
    rows = (
        (
            await db.execute(
                select(Document)
                .where(Document.created_by == user.id)
                .where(Document.status == DocumentStatus.DRAFT)
                .order_by(desc(Document.updated_at))
                .limit(3)
            )
        )
        .scalars()
        .all()
    )
    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=d.title or "（未命名草稿）",
                subtitle=d.serial_number,
                href=f"/documents/{d.serial_number}/edit" if d.serial_number else "/documents",
                timestamp=d.updated_at,
            ),
            base_score=32,
            reason="草稿尚未送審",
            action="補齊內容後送出簽核",
        )
        for d in rows
    ]
    return DashboardWidget(
        key="doc_draft",
        title="我的草稿",
        summary=f"{count} 份公文未送審",
        count=count,
        href="/documents?status=draft",
        severity="info",
        items=items,
    )


async def _w_doc_pending_my_approval(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> DashboardWidget | None:
    if not is_admin and not _has(perms, is_admin, "document:approve"):
        return None
    now = datetime.now(UTC)
    active_assignment = select(DocumentApprovalDelegation.id).where(
        DocumentApprovalDelegation.principal_user_id == DocumentApproval.approver_id,
        DocumentApprovalDelegation.delegate_user_id == user.id,
        DocumentApprovalDelegation.org_id == Document.org_id,
        DocumentApprovalDelegation.is_active.is_(True),
        DocumentApprovalDelegation.start_at <= now,
        or_(
            DocumentApprovalDelegation.end_at.is_(None),
            DocumentApprovalDelegation.end_at >= now,
        ),
    )
    stmt = (
        select(Document, DocumentApproval)
        .join(DocumentApproval, DocumentApproval.document_id == Document.id)
        .where(DocumentApproval.status == ApprovalStepStatus.PENDING)
        .where(
            or_(
                DocumentApproval.approver_id == user.id,
                and_(
                    DocumentApproval.delegate_source == DelegateSource.MANUAL,
                    DocumentApproval.delegate_id == user.id,
                ),
                and_(
                    DocumentApproval.delegate_source == DelegateSource.ASSIGNMENT,
                    active_assignment.exists(),
                ),
            )
        )
        .order_by(desc(Document.updated_at))
        .limit(50)
    )
    rows = (await db.execute(stmt)).all()
    count = len(rows)
    if count == 0:
        return None

    # SLA 預警：偵測超過 3 天未更新的公文。
    sla_cutoff = now - timedelta(days=3)
    overdue = sum(1 for (d, _a) in rows if d.updated_at and d.updated_at < sla_cutoff)

    preview = rows[:3]
    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=d.title or "（公文）",
                subtitle=d.serial_number,
                href=f"/documents/{d.serial_number}" if d.serial_number else "/documents",
                timestamp=d.updated_at,
                badge=(
                    f"逾期 {(now - d.updated_at).days} 天"
                    if d.updated_at and d.updated_at < sla_cutoff
                    else None
                ),
            ),
            base_score=92 if d.updated_at and d.updated_at < sla_cutoff else 72,
            reason="等待您作成簽核決定",
            action="開啟公文完成核准或退回",
        )
        for (d, _a) in preview
    ]

    if overdue > 0:
        severity = "critical"
        summary = f"{count} 份等待您決定（{overdue} 份逾期）"
    elif count > 5:
        severity = "critical"
        summary = f"{count} 份等待您決定"
    else:
        severity = "warning"
        summary = f"{count} 份等待您決定"

    return DashboardWidget(
        key="doc_pending_my_approval",
        title="待我簽核",
        summary=summary,
        count=count,
        href="/documents?status=pending&my_approval=true",
        severity=severity,
        items=items,
    )


async def _w_meeting_upcoming(db: AsyncSession, user: User) -> DashboardWidget | None:
    now = datetime.now(UTC)
    cutoff = now + timedelta(hours=72)
    stmt = (
        select(Meeting)
        .join(MeetingAttendance, MeetingAttendance.meeting_id == Meeting.id)
        .where(MeetingAttendance.user_id == user.id)
        .where(MeetingAttendance.status != AttendanceStatus.ABSENT)
        .where(
            Meeting.status.in_([MeetingStatus.DRAFT, MeetingStatus.ACTIVE, MeetingStatus.PAUSED])
        )
        .where(Meeting.starts_at.is_not(None))
        .where(Meeting.starts_at >= now)
        .where(Meeting.starts_at <= cutoff)
        .order_by(Meeting.starts_at)
        .limit(5)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return None

    # 依最早一場會議的剩餘時間調整 severity 與標題。
    soonest = min(m.starts_at for m in rows if m.starts_at is not None)
    minutes_to_start = (soonest - now).total_seconds() / 60
    if minutes_to_start <= 30:
        severity = "critical"
        title = "會議即將開始"
        summary = f"{int(minutes_to_start)} 分鐘後開始"
    elif minutes_to_start <= 120:
        severity = "warning"
        title = "會議即將開始"
        summary = f"{int(minutes_to_start / 60)} 小時內開始"
    elif minutes_to_start <= 24 * 60:
        severity = "warning"
        title = "今日出席的會議"
        summary = f"{len(rows)} 場（24 小時內）"
    else:
        severity = "info"
        title = "即將出席的會議"
        summary = f"{len(rows)} 場（72 小時內）"

    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=m.title,
                subtitle=m.location or None,
                href=f"/meetings/{m.id}",
                timestamp=m.starts_at,
            ),
            base_score=82 if minutes_to_start <= 120 else 48,
            reason="會議時間接近",
            action="確認議程、出席與會議資料",
        )
        for m in rows
    ]
    return DashboardWidget(
        key="meeting_upcoming",
        title=title,
        summary=summary,
        count=len(rows),
        href="/meetings",
        severity=severity,
        items=items,
    )


async def _w_regulation_review(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> DashboardWidget | None:
    if not _is_leader(perms, is_admin) and not _has(perms, is_admin, "regulation:create"):
        return None
    stmt = (
        select(Regulation)
        .where(
            Regulation.workflow_status.in_(
                [
                    RegulationWorkflowStatus.UNDER_REVIEW,
                    RegulationWorkflowStatus.SCHEDULED,
                    RegulationWorkflowStatus.COUNCIL_APPROVED,
                ]
            )
        )
        .order_by(desc(Regulation.updated_at))
        .limit(10)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return None
    label_map = {
        RegulationWorkflowStatus.UNDER_REVIEW: "送審中",
        RegulationWorkflowStatus.SCHEDULED: "排入議程",
        RegulationWorkflowStatus.COUNCIL_APPROVED: "待主席公布",
    }
    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=r.title,
                subtitle=f"v{r.version}",
                href=f"/regulations/{r.id}",
                badge=label_map.get(r.workflow_status, str(r.workflow_status)),
                timestamp=r.updated_at,
            ),
            base_score=70 if r.workflow_status == RegulationWorkflowStatus.COUNCIL_APPROVED else 52,
            reason="法規仍在審議流程中",
            action="確認目前階段並推進下一步",
        )
        for r in rows[:5]
    ]
    return DashboardWidget(
        key="regulation_review",
        title="法規審議中",
        summary=f"{len(rows)} 份在流程內",
        count=len(rows),
        href="/regulations",
        severity="info",
        items=items,
    )


async def _w_regulation_publish(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> DashboardWidget | None:
    if not (is_admin or _has(perms, is_admin, "president:publish")):
        return None
    stmt = (
        select(Regulation)
        .where(Regulation.workflow_status == RegulationWorkflowStatus.COUNCIL_APPROVED)
        .order_by(desc(Regulation.updated_at))
        .limit(10)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return None
    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=r.title,
                subtitle=f"v{r.version}（議會核定）",
                href=f"/regulations/{r.id}",
                timestamp=r.updated_at,
            ),
            base_score=92,
            reason="已核定但尚未公布",
            action="確認內容後公布",
        )
        for r in rows[:5]
    ]
    return DashboardWidget(
        key="regulation_publish",
        title="待主席公布",
        summary=f"{len(rows)} 份已核定",
        count=len(rows),
        href="/regulations?workflow=council_approved",
        severity="critical",
        items=items,
    )


async def _w_petition_assigned(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> DashboardWidget | None:
    if not (is_admin or any(p.startswith("petition:") for p in perms)):
        return None
    stmt = (
        select(PetitionCase)
        .where(PetitionCase.assigned_to_id == user.id)
        .where(
            PetitionCase.status.in_(
                [
                    PetitionStatus.SUBMITTED,
                    PetitionStatus.IN_PROGRESS,
                    PetitionStatus.NEEDS_INFO,
                ]
            )
        )
        .order_by(desc(PetitionCase.submitted_at))
        .limit(10)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return None
    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=p.title,
                subtitle=p.case_number,
                href=f"/petitions/{p.case_number}",
                timestamp=p.submitted_at,
            ),
            base_score=68 if p.status == PetitionStatus.NEEDS_INFO else 58,
            reason="陳情案件需要承辦回應",
            action="更新處理進度或回覆當事人",
        )
        for p in rows[:5]
    ]
    return DashboardWidget(
        key="petition_assigned",
        title="我承辦的陳情",
        summary=f"{len(rows)} 件待處理",
        count=len(rows),
        href="/petitions/manage",
        severity="warning",
        items=items,
    )


async def _w_open_surveys(db: AsyncSession, user: User) -> DashboardWidget | None:
    stmt = (
        select(Survey)
        .where(Survey.status == SurveyStatus.OPEN)
        .order_by(desc(Survey.updated_at))
        .limit(5)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return None
    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=s.title,
                href=f"/surveys/{s.id}",
                timestamp=s.updated_at,
            ),
            base_score=34,
            reason="問卷開放中",
            action="完成填答",
        )
        for s in rows
    ]
    return DashboardWidget(
        key="open_surveys",
        title="可填的問卷",
        summary=f"{len(rows)} 份開放中",
        count=len(rows),
        href="/surveys",
        severity="info",
        items=items,
    )


async def _w_announcements_recent(db: AsyncSession, user: User) -> DashboardWidget | None:
    now = datetime.now(UTC)
    week_ago = now - timedelta(days=7)
    stmt = (
        select(Announcement)
        .where(Announcement.created_at >= week_ago)
        .order_by(desc(Announcement.created_at))
        .limit(5)
    )
    try:
        rows = (await db.execute(stmt)).scalars().all()
    except Exception:
        logger.warning("dashboard: announcement query failed", exc_info=True)
        return None
    if not rows:
        return None
    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=getattr(a, "title", "(公告)"),
                href=f"/announcements/{a.id}",
                timestamp=a.created_at,
            ),
            base_score=30,
            reason="最近一週公告",
            action="查看公告內容",
        )
        for a in rows
    ]
    return DashboardWidget(
        key="announcements_recent",
        title="最近一週公告",
        summary=f"{len(rows)} 則更新",
        count=len(rows),
        href="/announcements",
        severity="info",
        items=items,
    )


# ── 聚合 ─────────────────────────────────────────────────────────────────────


async def _safe_run(
    fn: Callable[[], Awaitable[DashboardWidget | None]],
    name: str,
) -> DashboardWidget | None:
    """執行 widget builder，任何例外都降級為 None。"""
    try:
        return await fn()
    except Exception:
        logger.warning("dashboard widget %s failed", name, exc_info=True)
        return None


async def build_dashboard(db: AsyncSession, user: User) -> DashboardResponse:
    """聚合當前使用者的儀表板 widgets。"""
    perms = await get_user_permission_codes(db, user.id)
    is_admin = bool(getattr(user, "is_superuser", False))
    hint = _layout_hint(perms, is_admin)

    results = await asyncio.gather(
        _safe_run(
            lambda: _w_doc_pending_my_approval(db, user, perms, is_admin), "doc_pending_my_approval"
        ),
        _safe_run(lambda: _w_meeting_upcoming(db, user), "meeting_upcoming"),
        _safe_run(lambda: _w_regulation_publish(db, user, perms, is_admin), "regulation_publish"),
        _safe_run(lambda: _w_regulation_review(db, user, perms, is_admin), "regulation_review"),
        _safe_run(lambda: _w_petition_assigned(db, user, perms, is_admin), "petition_assigned"),
        _safe_run(lambda: _w_doc_draft(db, user), "doc_draft"),
        _safe_run(lambda: _w_open_surveys(db, user), "open_surveys"),
        _safe_run(lambda: _w_announcements_recent(db, user), "announcements_recent"),
    )
    widgets = [w for w in results if w is not None]

    if hint == "student":
        preferred_keys = ("announcements_recent", "open_surveys", "today_meal")
    elif hint == "leader":
        preferred_keys = ("regulation_publish", "doc_pending_my_approval", "regulation_review")
    else:
        preferred_keys = ("doc_pending_my_approval", "meeting_upcoming", "petition_assigned")
    widgets = prioritize_dashboard_widgets(widgets, preferred_keys=preferred_keys)

    return DashboardResponse(widgets=widgets, layout_hint=hint)
