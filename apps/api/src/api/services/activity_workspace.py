"""活動工作區聚合與半自動關聯推薦。"""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity
from api.models.activity_link import ActivityLink, ActivityLinkKind
from api.models.announcement import Announcement
from api.models.document import Document
from api.models.meal import MealOrder, MenuSchedule
from api.models.meeting import Meeting
from api.models.petition import PetitionCase
from api.models.publication import PublicationCampaign
from api.models.receivable import Receivable, ReceivableStatus
from api.models.regulation import Regulation
from api.models.shop import Order, Product
from api.models.survey import Survey
from api.models.work_item import WorkItem, WorkItemStatus
from api.schemas.activity_link import ActivityLinkCreate, ActivityLinkSuggestion


@dataclass
class Candidate:
    target_type: ActivityLinkKind
    target_id: uuid.UUID
    title: str
    href: str
    org_id: uuid.UUID | None = None
    created_by: uuid.UUID | None = None
    timestamp: datetime | None = None
    meta: dict | None = None


async def list_links(db: AsyncSession, activity_id: uuid.UUID) -> list[ActivityLink]:
    rows = await db.execute(
        select(ActivityLink)
        .where(ActivityLink.activity_id == activity_id)
        .order_by(ActivityLink.target_type, ActivityLink.created_at.desc())
    )
    return list(rows.scalars().all())


async def create_link(
    db: AsyncSession,
    activity_id: uuid.UUID,
    data: ActivityLinkCreate,
    *,
    actor_id: uuid.UUID,
) -> ActivityLink:
    existing = await db.scalar(
        select(ActivityLink).where(
            ActivityLink.activity_id == activity_id,
            ActivityLink.target_type == data.target_type.value,
            ActivityLink.target_id == data.target_id,
        )
    )
    if existing:
        return existing
    link = ActivityLink(
        activity_id=activity_id,
        created_by_id=actor_id,
        target_type=data.target_type.value,
        **data.model_dump(exclude={"target_type"}),
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)
    return link


async def delete_link(db: AsyncSession, link: ActivityLink) -> None:
    await db.delete(link)
    await db.flush()


async def get_link(db: AsyncSession, link_id: uuid.UUID) -> ActivityLink | None:
    return await db.get(ActivityLink, link_id)


async def workspace(db: AsyncSession, activity: Activity) -> dict:
    links = await list_links(db, activity.id)
    grouped: dict[str, list[ActivityLink]] = defaultdict(list)
    for link in links:
        grouped[link.target_type].append(link)

    pending_items = await _pending_items(db, activity.id)
    checklist = await _checklist(db, activity, links)
    suggestions = await suggestions_for_activity(db, activity, limit=8)
    section_titles = {
        "announcement": "公告",
        "survey": "問卷",
        "shop_product": "購票商品",
        "shop_order": "購票訂單",
        "meal_schedule": "學餐排程",
        "meal_order": "學餐訂單",
        "meeting": "會議",
        "document": "公文",
        "regulation": "法規",
        "petition": "陳情",
        "work_item": "工作項目",
        "receivable": "收款",
        "publication": "發布",
    }
    sections = [
        {"key": key, "title": section_titles.get(key, key), "count": len(items), "items": items}
        for key, items in grouped.items()
    ]
    return {
        "activity_id": activity.id,
        "sections": sections,
        "pending_items": pending_items,
        "checklist": checklist,
        "suggestions": suggestions,
    }


async def closing_report(db: AsyncSession, activity_id: uuid.UUID) -> dict:
    links = await list_links(db, activity_id)
    linked_counts = Counter(link.target_type for link in links)
    recv_rows = await db.execute(
        select(
            Receivable.status,
            func.count(Receivable.id),
            func.coalesce(func.sum(Receivable.amount), 0),
        )
        .where(Receivable.activity_id == activity_id)
        .group_by(Receivable.status)
    )
    task_rows = await db.execute(
        select(WorkItem.status, func.count(WorkItem.id))
        .where(WorkItem.source_type == "activity", WorkItem.source_id == activity_id)
        .group_by(WorkItem.status)
    )
    pub_rows = await db.execute(
        select(PublicationCampaign.status, func.count(PublicationCampaign.id))
        .where(PublicationCampaign.activity_id == activity_id)
        .group_by(PublicationCampaign.status)
    )
    return {
        "activity_id": activity_id,
        "linked_counts": dict(linked_counts),
        "receivables": {str(row.status): int(row.count) for row in recv_rows},
        "tasks": {str(row.status): int(row.count) for row in task_rows},
        "publications": {str(row.status): int(row.count) for row in pub_rows},
        "generated_at": datetime.now(UTC),
    }


async def suggestions_for_activity(
    db: AsyncSession, activity: Activity, *, limit: int = 20
) -> list[ActivityLinkSuggestion]:
    existing = {(row.target_type, row.target_id) for row in await list_links(db, activity.id)}
    candidates = await _candidates(db, activity)
    convener_ids = {convener.user_id for convener in getattr(activity, "conveners", [])}
    suggestions: list[ActivityLinkSuggestion] = []
    for candidate in candidates:
        if (candidate.target_type.value, candidate.target_id) in existing:
            continue
        score, reasons = _score(activity, candidate, convener_ids)
        if score < 45:
            continue
        suggestion_id = f"{candidate.target_type.value}:{candidate.target_id}"
        suggestions.append(
            ActivityLinkSuggestion(
                suggestion_id=suggestion_id,
                target_type=candidate.target_type,
                target_id=candidate.target_id,
                title=candidate.title,
                href=candidate.href,
                score=score,
                reasons=reasons,
                meta=candidate.meta or {},
            )
        )
    return sorted(suggestions, key=lambda item: item.score, reverse=True)[:limit]


async def accept_suggestion(
    db: AsyncSession,
    activity: Activity,
    suggestion_id: str,
    *,
    actor_id: uuid.UUID,
) -> ActivityLink:
    suggestions = await suggestions_for_activity(db, activity, limit=100)
    selected = next((item for item in suggestions if item.suggestion_id == suggestion_id), None)
    if selected is None:
        raise ValueError("推薦不存在或分數不足")
    return await create_link(
        db,
        activity.id,
        ActivityLinkCreate(
            target_type=selected.target_type,
            target_id=selected.target_id,
            title=selected.title,
            href=selected.href,
            meta={"suggestion_score": selected.score, "reasons": selected.reasons},
        ),
        actor_id=actor_id,
    )


async def _candidates(db: AsyncSession, activity: Activity) -> list[Candidate]:
    candidates: list[Candidate] = []
    start = (activity.starts_at or activity.created_at or datetime.now(UTC)) - timedelta(days=45)
    end = (activity.ends_at or activity.starts_at or datetime.now(UTC)) + timedelta(days=45)

    for row in (
        await db.execute(
            select(Announcement).where(Announcement.created_at.between(start, end)).limit(200)
        )
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.ANNOUNCEMENT,
                row.id,
                row.title,
                f"/announcements/{row.id}",
                row.org_id,
                row.author_id,
                row.published_at or row.created_at,
            )
        )
    for row in (
        await db.execute(select(Survey).where(Survey.created_at.between(start, end)).limit(200))
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.SURVEY,
                row.id,
                row.title,
                f"/surveys/{row.id}",
                row.org_id,
                row.created_by,
                row.created_at,
            )
        )
    for row in (
        await db.execute(select(Product).where(Product.created_at.between(start, end)).limit(200))
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.SHOP_PRODUCT,
                row.id,
                row.name,
                f"/shop/admin?product={row.id}",
                row.org_id,
                row.created_by,
                row.sale_start or row.created_at,
            )
        )
    for row in (
        await db.execute(select(Order).where(Order.created_at.between(start, end)).limit(200))
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.SHOP_ORDER,
                row.id,
                row.serial_number,
                f"/shop/orders/{row.id}",
                row.org_id,
                row.user_id,
                row.created_at,
                {"amount": row.total_price},
            )
        )
    for row in (
        await db.execute(
            select(MenuSchedule).where(MenuSchedule.order_deadline.between(start, end)).limit(200)
        )
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.MEAL_SCHEDULE,
                row.id,
                f"學餐排程 {row.date}",
                f"/meal/vendor?schedule={row.id}",
                None,
                row.created_by,
                row.order_deadline,
            )
        )
    for row in (
        await db.execute(
            select(MealOrder).where(MealOrder.created_at.between(start, end)).limit(200)
        )
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.MEAL_ORDER,
                row.id,
                row.serial_number,
                f"/meal/orders/{row.id}",
                None,
                row.user_id,
                row.created_at,
                {"amount": row.total_price},
            )
        )
    for row in (
        await db.execute(select(Meeting).where(Meeting.created_at.between(start, end)).limit(200))
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.MEETING,
                row.id,
                row.title,
                f"/meetings/{row.id}",
                row.org_id,
                row.created_by,
                row.starts_at or row.created_at,
            )
        )
    for row in (
        await db.execute(select(Document).where(Document.created_at.between(start, end)).limit(200))
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.DOCUMENT,
                row.id,
                row.title or "公文",
                f"/documents/{row.serial_number or row.id}",
                row.org_id,
                row.created_by,
                row.created_at,
            )
        )
    for row in (
        await db.execute(
            select(Regulation).where(Regulation.created_at.between(start, end)).limit(200)
        )
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.REGULATION,
                row.id,
                row.title,
                f"/regulations/{row.id}",
                row.org_id,
                row.created_by,
                row.created_at,
            )
        )
    for row in (
        await db.execute(
            select(PetitionCase).where(PetitionCase.submitted_at.between(start, end)).limit(200)
        )
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.PETITION,
                row.id,
                row.title,
                f"/petitions/{row.case_number}",
                row.current_org_id,
                row.assigned_to_id,
                row.submitted_at,
            )
        )
    for row in (
        await db.execute(select(WorkItem).where(WorkItem.created_at.between(start, end)).limit(200))
    ).scalars():
        candidates.append(
            Candidate(
                ActivityLinkKind.WORK_ITEM,
                row.id,
                row.title,
                f"/tasks?work_item={row.id}",
                None,
                row.created_by_id,
                row.due_at or row.created_at,
            )
        )
    return candidates


def _score(
    activity: Activity, candidate: Candidate, convener_ids: set[uuid.UUID]
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    if activity.org_id and candidate.org_id == activity.org_id:
        score += 30
        reasons.append("同一主辦組織")
    if candidate.timestamp and activity.starts_at:
        window_start = activity.starts_at - timedelta(days=30)
        window_end = (activity.ends_at or activity.starts_at) + timedelta(days=30)
        if window_start <= candidate.timestamp <= window_end:
            score += 25
            reasons.append("時間接近活動期間")
    name = activity.name.lower()
    title = candidate.title.lower()
    if name and name in title:
        score += 35
        reasons.append("標題包含活動名稱")
    else:
        for token in [part for part in name.replace("　", " ").split(" ") if len(part) >= 2]:
            if token in title:
                score += 12
                reasons.append(f"標題包含關鍵字「{token}」")
                break
    if candidate.created_by in convener_ids:
        score += 20
        reasons.append("建立者是活動總召")
    return min(score, 100), reasons


async def _pending_items(db: AsyncSession, activity_id: uuid.UUID) -> list[dict]:
    items: list[dict] = []
    work_items = (
        await db.execute(
            select(WorkItem)
            .where(
                WorkItem.source_type == "activity",
                WorkItem.source_id == activity_id,
                WorkItem.status == WorkItemStatus.OPEN,
                WorkItem.is_active.is_(True),
            )
            .order_by(WorkItem.due_at.asc().nullslast())
            .limit(8)
        )
    ).scalars()
    for item in work_items:
        items.append(
            {
                "title": item.title,
                "href": f"/tasks?work_item={item.id}",
                "due_at": item.due_at,
                "kind": "work_item",
            }
        )
    unpaid = await db.scalar(
        select(func.count(Receivable.id)).where(
            Receivable.activity_id == activity_id,
            Receivable.status.in_([ReceivableStatus.UNPAID.value, ReceivableStatus.PARTIAL.value]),
        )
    )
    if unpaid:
        items.append(
            {
                "title": f"{int(unpaid)} 筆款項尚未收齊",
                "href": f"/finance/receivables?activity_id={activity_id}",
                "kind": "receivable",
            }
        )
    return items


async def _checklist(db: AsyncSession, activity: Activity, links: list[ActivityLink]) -> list[dict]:
    types = {link.target_type for link in links}
    pending = await _pending_items(db, activity.id)
    return [
        {
            "key": "announcement",
            "title": "活動公告",
            "status": "done" if "announcement" in types else "open",
            "action": "建立或關聯活動公告",
        },
        {
            "key": "tasks",
            "title": "責任分工",
            "status": "warning" if pending else "done",
            "action": "確認任務負責人與期限",
        },
        {
            "key": "receivables",
            "title": "收款對帳",
            "status": "done" if "receivable" in types else "open",
            "action": "建立應收款或確認訂單同步",
        },
        {
            "key": "closing",
            "title": "結案報告",
            "status": "open" if activity.status != "archived" else "done",
            "action": "活動結束後產生結案報告",
        },
    ]
