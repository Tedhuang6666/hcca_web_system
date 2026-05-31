"""待辦中心聚合 service：跨模組組裝 TaskItem。

設計原則：
- 不持久化、每次 GET 即時計算（無狀態）。
- 各 builder 互相獨立、asyncio.gather 並行。
- 失敗只記 warning，不影響其他來源。
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.announcement import Announcement
from api.models.calendar import CalendarEvent, CalendarEventChecklistItem, CalendarEventParticipant
from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
)
from api.models.meal import MenuSchedule
from api.models.meeting import (
    AttendanceStatus,
    Meeting,
    MeetingAttendance,
    MeetingStatus,
)
from api.models.petition import PetitionCase, PetitionStatus
from api.models.regulation import Regulation, RegulationWorkflowStatus
from api.models.shop import Product, ProductStatus
from api.models.survey import Survey, SurveyStatus
from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus
from api.schemas.task import TaskInboxResponse, TaskItem
from api.services.permission import get_user_permission_codes

logger = logging.getLogger(__name__)


def _has(perms: frozenset[str], is_admin: bool, code: str) -> bool:
    if is_admin or "admin:all" in perms:
        return True
    if code.endswith(":*"):
        prefix = code[:-1]
        return any(p.startswith(prefix) for p in perms)
    return code in perms


def _severity_by_due(due_at: datetime | None) -> str:
    if due_at is None:
        return "info"
    now = datetime.now(UTC)
    if due_at < now:
        return "critical"
    if (due_at - now) <= timedelta(hours=24):
        return "warning"
    return "info"


# ── Builders ─────────────────────────────────────────────────────────────────


async def _docs_pending_my_approval(db: AsyncSession, user: User) -> list[TaskItem]:
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
    items: list[TaskItem] = []
    for d, _a in rows:
        items.append(
            TaskItem(
                id=f"document:{d.id}:approve",
                module="document",
                action="approve",
                title=f"簽核：{d.title}",
                subtitle=d.serial_number,
                href=f"/documents/{d.serial_number}" if d.serial_number else "/documents",
                due_at=None,
                severity="warning",
                created_at=d.updated_at or d.created_at,
            )
        )
    return items


async def _meetings_upcoming(db: AsyncSession, user: User) -> list[TaskItem]:
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
        .limit(20)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        TaskItem(
            id=f"meeting:{m.id}:attend",
            module="meeting",
            action="attend",
            title=f"出席：{m.title}",
            subtitle=m.location or None,
            href=f"/meetings/{m.id}",
            due_at=m.starts_at,
            severity=_severity_by_due(m.starts_at),
            created_at=m.created_at,
        )
        for m in rows
    ]


async def _regulations_to_publish(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> list[TaskItem]:
    if not (is_admin or _has(perms, is_admin, "president:publish")):
        return []
    rows = (
        (
            await db.execute(
                select(Regulation)
                .where(Regulation.workflow_status == RegulationWorkflowStatus.COUNCIL_APPROVED)
                .order_by(desc(Regulation.updated_at))
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"regulation:{r.id}:publish",
            module="regulation",
            action="publish",
            title=f"公布：{r.title}",
            subtitle=f"v{r.version}（議會核定）",
            href=f"/regulations/{r.id}",
            severity="critical",
            created_at=r.updated_at,
        )
        for r in rows
    ]


async def _regulations_to_review(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> list[TaskItem]:
    if not (
        is_admin
        or _has(perms, is_admin, "regulation:schedule")
        or _has(perms, is_admin, "regulation:council_approve")
    ):
        return []
    rows = (
        (
            await db.execute(
                select(Regulation)
                .where(
                    Regulation.workflow_status.in_(
                        [
                            RegulationWorkflowStatus.UNDER_REVIEW,
                            RegulationWorkflowStatus.SCHEDULED,
                        ]
                    )
                )
                .order_by(desc(Regulation.updated_at))
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"regulation:{r.id}:review",
            module="regulation",
            action="review",
            title=f"審議：{r.title}",
            subtitle=f"v{r.version}",
            href=f"/regulations/{r.id}",
            severity="info",
            created_at=r.updated_at,
        )
        for r in rows
    ]


async def _petitions_assigned(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> list[TaskItem]:
    if not (is_admin or any(p.startswith("petition:") for p in perms)):
        return []
    rows = (
        (
            await db.execute(
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
                .limit(30)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"petition:{p.id}:reply",
            module="petition",
            action="reply",
            title=f"陳情：{p.title}",
            subtitle=p.case_number,
            href=f"/petitions/{p.case_number}",
            severity="warning",
            created_at=p.submitted_at,
        )
        for p in rows
    ]


async def _surveys_to_fill(db: AsyncSession, user: User) -> list[TaskItem]:
    rows = (
        (
            await db.execute(
                select(Survey)
                .where(Survey.status == SurveyStatus.OPEN)
                .order_by(desc(Survey.updated_at))
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"survey:{s.id}:fill",
            module="survey",
            action="fill",
            title=f"填答：{s.title}",
            href=f"/surveys/{s.id}",
            severity="info",
            created_at=s.updated_at or s.created_at,
        )
        for s in rows
    ]


async def _calendar_checklist_assigned(db: AsyncSession, user: User) -> list[TaskItem]:
    rows = (
        await db.execute(
            select(CalendarEventChecklistItem, CalendarEvent)
            .join(CalendarEvent, CalendarEvent.id == CalendarEventChecklistItem.event_id)
            .where(CalendarEventChecklistItem.assignee_id == user.id)
            .where(CalendarEventChecklistItem.is_done.is_(False))
            .where(CalendarEvent.is_active.is_(True))
            .order_by(
                CalendarEventChecklistItem.due_at.asc().nulls_last(),
                desc(CalendarEventChecklistItem.created_at),
            )
            .limit(30)
        )
    ).all()
    return [
        TaskItem(
            id=f"calendar:{item.id}:prepare",
            module="calendar",
            action="prepare",
            title=f"準備：{item.title}",
            subtitle=event.title,
            href=f"/calendar?event={event.id}",
            due_at=item.due_at,
            severity=_severity_by_due(item.due_at),
            created_at=item.created_at,
        )
        for item, event in rows
    ]


async def _calendar_events_to_attend(db: AsyncSession, user: User) -> list[TaskItem]:
    now = datetime.now(UTC)
    cutoff = now + timedelta(hours=72)
    rows = (
        (
            await db.execute(
                select(CalendarEvent)
                .join(
                    CalendarEventParticipant, CalendarEventParticipant.event_id == CalendarEvent.id
                )
                .where(CalendarEventParticipant.user_id == user.id)
                .where(CalendarEvent.starts_at >= now, CalendarEvent.starts_at <= cutoff)
                .where(CalendarEvent.is_active.is_(True))
                .order_by(CalendarEvent.starts_at.asc())
                .limit(30)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"calendar:{event.id}:attend",
            module="calendar",
            action="attend",
            title=f"行程：{event.title}",
            subtitle=event.location,
            href=event.href or f"/calendar?event={event.id}",
            due_at=event.starts_at,
            severity=_severity_by_due(event.starts_at),
            created_at=event.created_at,
        )
        for event in rows
    ]


async def _announcements_to_publish(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> list[TaskItem]:
    if not (is_admin or _has(perms, is_admin, "announcement:publish")):
        return []
    rows = (
        (
            await db.execute(
                select(Announcement)
                .where(Announcement.is_published.is_(False))
                .order_by(desc(Announcement.updated_at))
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"announcement:{ann.id}:publish",
            module="announcement",
            action="publish",
            title=f"發布公告：{ann.title}",
            href=f"/announcements/{ann.id}/edit",
            severity="info",
            created_at=ann.updated_at,
        )
        for ann in rows
    ]


async def _shop_sales_to_manage(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> list[TaskItem]:
    if not (is_admin or _has(perms, is_admin, "shop:manage")):
        return []
    now = datetime.now(UTC)
    cutoff = now + timedelta(hours=48)
    rows = (
        (
            await db.execute(
                select(Product)
                .where(Product.status == ProductStatus.ACTIVE)
                .where(Product.sale_end.is_not(None))
                .where(Product.sale_end >= now, Product.sale_end <= cutoff)
                .order_by(Product.sale_end.asc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"shop:{product.id}:manage",
            module="shop",
            action="manage",
            title=f"商品即將停售：{product.name}",
            href="/shop/admin",
            due_at=product.sale_end,
            severity=_severity_by_due(product.sale_end),
            created_at=product.updated_at,
        )
        for product in rows
    ]


async def _meal_deadlines_to_manage(
    db: AsyncSession, user: User, perms: frozenset[str], is_admin: bool
) -> list[TaskItem]:
    if not (
        is_admin
        or _has(perms, is_admin, "meal:manage")
        or _has(perms, is_admin, "meal:manage_schedule")
    ):
        return []
    now = datetime.now(UTC)
    cutoff = now + timedelta(hours=48)
    rows = (
        (
            await db.execute(
                select(MenuSchedule)
                .where(MenuSchedule.is_closed.is_(False))
                .where(MenuSchedule.order_deadline >= now, MenuSchedule.order_deadline <= cutoff)
                .order_by(MenuSchedule.order_deadline.asc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"meal:{schedule.id}:manage",
            module="meal",
            action="manage",
            title="學餐即將結單",
            subtitle=schedule.note,
            href="/meal/vendor",
            due_at=schedule.order_deadline,
            severity=_severity_by_due(schedule.order_deadline),
            created_at=schedule.created_at,
        )
        for schedule in rows
    ]


async def _work_items_assigned(db: AsyncSession, user: User) -> list[TaskItem]:
    rows = (
        (
            await db.execute(
                select(WorkItem)
                .where(WorkItem.assigned_to_id == user.id)
                .where(WorkItem.status == WorkItemStatus.OPEN)
                .where(WorkItem.is_active.is_(True))
                .order_by(WorkItem.due_at.asc().nulls_last(), desc(WorkItem.created_at))
                .limit(50)
            )
        )
        .scalars()
        .all()
    )
    return [
        TaskItem(
            id=f"work_item:{item.id}:complete",
            module="work_item",
            action="complete",
            title=f"工作：{item.title}",
            subtitle=item.description[:80] if item.description else None,
            href="/tasks",
            due_at=item.due_at,
            severity=_severity_by_due(item.due_at),
            created_at=item.created_at,
        )
        for item in rows
    ]


# ── 聚合 ─────────────────────────────────────────────────────────────────────


async def _safe(name: str, fn: Callable[[], Awaitable[list[TaskItem]]]) -> list[TaskItem]:
    try:
        return await fn()
    except Exception:
        logger.warning("task inbox source %s failed", name, exc_info=True)
        return []


async def build_task_inbox(db: AsyncSession, user: User) -> TaskInboxResponse:
    perms = await get_user_permission_codes(db, user.id)
    is_admin = bool(getattr(user, "is_superuser", False))

    groups = await asyncio.gather(
        _safe("docs_approve", lambda: _docs_pending_my_approval(db, user)),
        _safe("meetings_upcoming", lambda: _meetings_upcoming(db, user)),
        _safe("regulations_publish", lambda: _regulations_to_publish(db, user, perms, is_admin)),
        _safe("regulations_review", lambda: _regulations_to_review(db, user, perms, is_admin)),
        _safe("petitions_assigned", lambda: _petitions_assigned(db, user, perms, is_admin)),
        _safe("surveys_fill", lambda: _surveys_to_fill(db, user)),
        _safe("calendar_prepare", lambda: _calendar_checklist_assigned(db, user)),
        _safe("calendar_attend", lambda: _calendar_events_to_attend(db, user)),
        _safe(
            "announcements_publish", lambda: _announcements_to_publish(db, user, perms, is_admin)
        ),
        _safe("shop_sales", lambda: _shop_sales_to_manage(db, user, perms, is_admin)),
        _safe("meal_deadlines", lambda: _meal_deadlines_to_manage(db, user, perms, is_admin)),
        _safe("work_items_assigned", lambda: _work_items_assigned(db, user)),
    )
    items: list[TaskItem] = [it for g in groups for it in g]

    # 排序：critical → warning → info；同等級內 due_at 越近越前；其餘按 created_at desc
    def _sort_key(t: TaskItem) -> tuple:
        sev_order = {"critical": 0, "warning": 1, "info": 2}.get(t.severity, 3)
        due = t.due_at.timestamp() if t.due_at else float("inf")
        return (sev_order, due, -t.created_at.timestamp())

    items.sort(key=_sort_key)

    by_module: dict[str, int] = dict(Counter(t.module for t in items))
    return TaskInboxResponse(items=items, total=len(items), by_module=by_module)
