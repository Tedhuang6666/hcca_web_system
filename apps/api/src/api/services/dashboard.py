"""儀表板聚合 service：依角色組合 widgets，每個 widget 失敗時自動降級。

設計原則：
- 各 widget builder 互相獨立，使用 asyncio.gather 並行。
- 單一 builder 失敗只記 warning，不影響其他 widget。
- 每個 builder 回傳 DashboardWidget 或 None（None 表示不顯示）。
- 不寫業務邏輯，只是「拿既有資料彙整成 widget 卡片」。
- Redis 快取：整個儀表板回應快取 60 秒，權限/資料變更時失效。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from sqlalchemy.orm import load_only

from api.core.cache import cache_get, cache_invalidate_dashboard, cache_set
from api.core.database import AsyncSessionLocal
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
from api.schemas.announcement import AnnouncementListItem
from api.schemas.dashboard import (
    DashboardCompositeResponse,
    DashboardResponse,
    DashboardWidget,
    DashboardWidgetItem,
    LayoutHint,
)
from api.schemas.governance import MatterListItem
from api.schemas.task import TaskInboxResponse
from api.services import announcement as announcement_service
from api.services import matter as matter_service
from api.services.permission import get_user_permission_codes
from api.services.task_inbox import build_task_inbox_cached
from api.services.task_priority import prioritize_dashboard_widgets

logger = logging.getLogger(__name__)

# 快取設定
DASHBOARD_CACHE_TTL_SECONDS = 60
_dashboard_widget_semaphore = asyncio.Semaphore(4)


def _dashboard_cache_key(user_id: str) -> str:
    """儀表板快取鍵：含用戶 ID"""
    return f"dashboard:{user_id}"


def _dashboard_composite_cache_key(
    user_id: str,
    *,
    include_tasks: bool,
    include_matters: bool,
    include_announcements: bool,
    compact_dashboard: bool,
) -> str:
    return (
        f"dashboard:composite:{user_id}:"
        f"{int(include_tasks)}:{int(include_matters)}:{int(include_announcements)}"
        f":{int(compact_dashboard)}"
    )


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
    rows = (
        await db.execute(
            select(
                Document,
                func.count(Document.id).over().label("draft_count"),
            )
            .options(
                load_only(
                    Document.id,
                    Document.title,
                    Document.serial_number,
                    Document.updated_at,
                )
            )
            .where(Document.created_by == user.id)
            .where(Document.status == DocumentStatus.DRAFT)
            .order_by(desc(Document.updated_at))
            .limit(3)
        )
    ).all()
    if not rows:
        return None
    count = int(rows[0].draft_count)
    items = [
        _decorate_item_priority(
            DashboardWidgetItem(
                title=document.title or "（未命名草稿）",
                subtitle=document.serial_number,
                href=(
                    f"/documents/{document.serial_number}/edit"
                    if document.serial_number
                    else "/documents"
                ),
                timestamp=document.updated_at,
            ),
            base_score=32,
            reason="草稿尚未送審",
            action="補齊內容後送出簽核",
        )
        for document, _draft_count in rows
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
        .options(
            load_only(
                Document.id,
                Document.title,
                Document.serial_number,
                Document.updated_at,
            )
        )
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
        .options(load_only(Meeting.id, Meeting.title, Meeting.location, Meeting.starts_at))
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
        .options(
            load_only(
                Regulation.id,
                Regulation.title,
                Regulation.version,
                Regulation.workflow_status,
                Regulation.updated_at,
            )
        )
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
        .options(
            load_only(
                Regulation.id,
                Regulation.title,
                Regulation.version,
                Regulation.workflow_status,
                Regulation.updated_at,
            )
        )
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
        .options(
            load_only(
                PetitionCase.id,
                PetitionCase.title,
                PetitionCase.case_number,
                PetitionCase.status,
                PetitionCase.submitted_at,
            )
        )
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
        .options(load_only(Survey.id, Survey.title, Survey.updated_at))
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
        .options(load_only(Announcement.id, Announcement.title, Announcement.created_at))
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


async def _run_widget(
    db: AsyncSession,
    name: str,
    builder: Callable[[AsyncSession], Awaitable[DashboardWidget | None]],
) -> DashboardWidget | None:
    """在獨立 session 執行 widget，避免並行共用 AsyncSession。"""

    async def run() -> DashboardWidget | None:
        async with _dashboard_widget_semaphore:
            if isinstance(db.bind, AsyncEngine):
                async with AsyncSessionLocal() as widget_db:
                    return await builder(widget_db)
            return await builder(db)

    return await _safe_run(run, name)


async def _build_dashboard_uncached(
    db: AsyncSession,
    user: User,
    *,
    compact: bool = False,
) -> DashboardResponse:
    """聚合當前使用者的儀表板 widgets（不含快取邏輯）。"""
    perms = await get_user_permission_codes(db, user.id)
    is_admin = bool(getattr(user, "is_superuser", False))
    hint = _layout_hint(perms, is_admin)

    widget_builders: list[Awaitable[DashboardWidget | None]] = [
        _run_widget(db, "meeting_upcoming", lambda widget_db: _w_meeting_upcoming(widget_db, user)),
        _run_widget(
            db,
            "announcements_recent",
            lambda widget_db: _w_announcements_recent(widget_db, user),
        ),
    ]
    if compact:
        # 首屏只取一個角色最重要的工作 widget；完整儀表板由瀏覽器 hydration
        # 後背景載入，避免七個以上查詢排隊拖慢首頁可互動時間。
        if _is_leader(perms, is_admin):
            if is_admin or _has(perms, is_admin, "president:publish"):
                widget_builders.append(
                    _run_widget(
                        db,
                        "regulation_publish",
                        lambda widget_db: _w_regulation_publish(widget_db, user, perms, is_admin),
                    )
                )
            elif _has(perms, is_admin, "regulation:create"):
                widget_builders.append(
                    _run_widget(
                        db,
                        "regulation_review",
                        lambda widget_db: _w_regulation_review(widget_db, user, perms, is_admin),
                    )
                )
        elif is_admin or _has(perms, is_admin, "document:approve"):
            widget_builders.append(
                _run_widget(
                    db,
                    "doc_pending_my_approval",
                    lambda widget_db: _w_doc_pending_my_approval(widget_db, user, perms, is_admin),
                )
            )
        elif _is_officer(perms):
            widget_builders.append(
                _run_widget(db, "doc_draft", lambda widget_db: _w_doc_draft(widget_db, user))
            )
        else:
            widget_builders.append(
                _run_widget(db, "open_surveys", lambda widget_db: _w_open_surveys(widget_db, user))
            )
    else:
        widget_builders.extend(
            [
                _run_widget(db, "doc_draft", lambda widget_db: _w_doc_draft(widget_db, user)),
                _run_widget(db, "open_surveys", lambda widget_db: _w_open_surveys(widget_db, user)),
            ]
        )
        if is_admin or _has(perms, is_admin, "document:approve"):
            widget_builders.append(
                _run_widget(
                    db,
                    "doc_pending_my_approval",
                    lambda widget_db: _w_doc_pending_my_approval(widget_db, user, perms, is_admin),
                )
            )
        if is_admin or _has(perms, is_admin, "president:publish"):
            widget_builders.append(
                _run_widget(
                    db,
                    "regulation_publish",
                    lambda widget_db: _w_regulation_publish(widget_db, user, perms, is_admin),
                )
            )
        if _is_leader(perms, is_admin) or _has(perms, is_admin, "regulation:create"):
            widget_builders.append(
                _run_widget(
                    db,
                    "regulation_review",
                    lambda widget_db: _w_regulation_review(widget_db, user, perms, is_admin),
                )
            )
        if is_admin or any(permission.startswith("petition:") for permission in perms):
            widget_builders.append(
                _run_widget(
                    db,
                    "petition_assigned",
                    lambda widget_db: _w_petition_assigned(widget_db, user, perms, is_admin),
                )
            )

    results = await asyncio.gather(*widget_builders)
    widgets = [w for w in results if w is not None]

    if hint == "student":
        preferred_keys = ("announcements_recent", "open_surveys", "today_meal")
    elif hint == "leader":
        preferred_keys = ("regulation_publish", "doc_pending_my_approval", "regulation_review")
    else:
        preferred_keys = ("doc_pending_my_approval", "meeting_upcoming", "petition_assigned")
    widgets = prioritize_dashboard_widgets(widgets, preferred_keys=preferred_keys)

    return DashboardResponse(widgets=widgets, layout_hint=hint)


async def build_dashboard(
    db: AsyncSession,
    user: User,
    *,
    compact: bool = False,
) -> DashboardResponse:
    """聚合當前使用者的儀表板 widgets（含 Redis 快取 60s）。"""
    cache_key = _dashboard_cache_key(str(user.id))
    if compact:
        cache_key = f"{cache_key}:compact"

    # 嘗試從快取讀取
    cached = await cache_get(cache_key)
    if isinstance(cached, dict):
        try:
            return DashboardResponse.model_validate(cached)
        except Exception:
            logger.debug("dashboard cache payload invalid user=%s", user.id, exc_info=True)

    # 快取未命中：重新建構
    response = await _build_dashboard_uncached(db, user, compact=compact)

    # 寫入快取（排除 SQLAlchemy 模型物件，僅序列化 Pydantic）
    cache_data = response.model_dump(mode="json")
    await cache_set(cache_key, cache_data, DASHBOARD_CACHE_TTL_SECONDS)

    return response


async def invalidate_dashboard_cache(user_id: str | None = None) -> None:
    """失效儀表板快取。

    Args:
        user_id: 指定用戶時只清該用戶；None 則清全部儀表板快取。
    """
    await cache_invalidate_dashboard(user_id)


async def _with_component_session(
    db: AsyncSession,
    builder: Callable[[AsyncSession], Awaitable[object]],
) -> object:
    if isinstance(db.bind, AsyncEngine):
        async with AsyncSessionLocal() as component_db:
            return await builder(component_db)
    return await builder(db)


async def _dashboard_matters(db: AsyncSession, user: User) -> list[MatterListItem]:
    cache_key = f"dashboard:matters:{user.id}"
    cached = await cache_get(cache_key)
    if isinstance(cached, list):
        try:
            return [MatterListItem.model_validate(item) for item in cached]
        except Exception:
            logger.debug("dashboard matters cache payload invalid user=%s", user.id, exc_info=True)

    items = await matter_service.list_matters(
        db,
        user=user,
        status="active",
        limit=6,
    )
    await cache_set(
        cache_key,
        [item.model_dump(mode="json") for item in items],
        ttl=30,
    )
    return items


async def _dashboard_announcements(db: AsyncSession, user: User) -> list[AnnouncementListItem]:
    cache_key = f"dashboard:announcements:{user.id}"
    cached = await cache_get(cache_key)
    if isinstance(cached, list):
        try:
            return [AnnouncementListItem.model_validate(item) for item in cached]
        except Exception:
            logger.debug(
                "dashboard announcements cache payload invalid user=%s",
                user.id,
                exc_info=True,
            )

    scope = await announcement_service.get_viewer_scope(db, user)
    announcements = await announcement_service.list_announcements(
        db,
        published_only=True,
        limit=3,
        scope=scope,
    )
    items: list[AnnouncementListItem] = []
    for announcement in announcements:
        item = AnnouncementListItem.model_validate(announcement)
        author = getattr(announcement, "author", None)
        if author:
            item.author_name = getattr(author, "display_name", "")
        items.append(item)
    await cache_set(
        cache_key,
        [item.model_dump(mode="json") for item in items],
        ttl=30,
    )
    return items


async def build_dashboard_composite(
    db: AsyncSession,
    user: User,
    *,
    include_tasks: bool = True,
    include_matters: bool = True,
    include_announcements: bool = True,
    compact_dashboard: bool = False,
) -> DashboardCompositeResponse:
    """一次組裝 dashboard 首屏資料，降低前端 round trips。"""
    cache_key = _dashboard_composite_cache_key(
        str(user.id),
        include_tasks=include_tasks,
        include_matters=include_matters,
        include_announcements=include_announcements,
        compact_dashboard=compact_dashboard,
    )
    cached = await cache_get(cache_key)
    if isinstance(cached, dict):
        try:
            return DashboardCompositeResponse.model_validate(cached)
        except Exception:
            logger.debug(
                "dashboard composite cache payload invalid user=%s", user.id, exc_info=True
            )

    async def dashboard_component() -> DashboardResponse:
        result = await _with_component_session(
            db,
            lambda source_db: build_dashboard(
                source_db,
                user,
                compact=compact_dashboard,
            ),
        )
        return result  # type: ignore[return-value]

    async def tasks_component() -> TaskInboxResponse:
        result = await _with_component_session(
            db, lambda source_db: build_task_inbox_cached(source_db, user)
        )
        return result  # type: ignore[return-value]

    async def matters_component() -> list[MatterListItem]:
        result = await _with_component_session(
            db, lambda source_db: _dashboard_matters(source_db, user)
        )
        return result  # type: ignore[return-value]

    async def announcements_component() -> list[AnnouncementListItem]:
        result = await _with_component_session(
            db, lambda source_db: _dashboard_announcements(source_db, user)
        )
        return result  # type: ignore[return-value]

    components: list[Awaitable[object]] = [dashboard_component()]
    if include_tasks:
        components.append(tasks_component())
    if include_matters:
        components.append(matters_component())
    if include_announcements:
        components.append(announcements_component())

    if isinstance(db.bind, AsyncEngine):
        values = await asyncio.gather(*components)
    else:
        values = [await component for component in components]

    index = 0
    dashboard = values[index]
    index += 1
    tasks = values[index] if include_tasks else None
    index += int(include_tasks)
    matters = values[index] if include_matters else None
    index += int(include_matters)
    announcements = values[index] if include_announcements else None

    response = DashboardCompositeResponse(
        dashboard=dashboard,  # type: ignore[arg-type]
        tasks=tasks,  # type: ignore[arg-type]
        matters=matters,  # type: ignore[arg-type]
        announcements=announcements,  # type: ignore[arg-type]
    )
    await cache_set(cache_key, response.model_dump(mode="json"), ttl=20)
    return response
