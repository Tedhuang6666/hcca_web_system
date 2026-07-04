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
from api.models.calendar import CalendarEvent
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
from api.schemas.activity_link import (
    ActivityLinkCreate,
    ActivityLinkSuggestion,
    ActivitySpawnCreate,
)


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
    tasks = await _tasks(db, activity.id)
    meetings = await _meetings(db, activity.id, grouped["meeting"])
    calendar_events = await _calendar_events(db, activity.id)
    notifications = await _notifications(db, activity.id, grouped)
    finance = await _finance_summary(db, activity.id)
    procurement = await _procurement(db, activity.id, grouped)
    documents = await _documents(db, activity.id, grouped)
    people = _people(activity)
    section_titles = {
        "announcement": "公告",
        "survey": "問卷",
        "shop_product": "購票商品",
        "shop_order": "購票訂單",
        "meal_schedule": "學餐排程",
        "meal_order": "學餐訂單",
        "meeting": "會議",
        "calendar_event": "日曆事件",
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
        "matter_id": None,
        "summary": {
            "title": activity.name,
            "description": activity.description,
            "status": activity.status,
            "starts_at": activity.starts_at,
            "ends_at": activity.ends_at,
            "linked_count": sum(len(items) for items in grouped.values()),
            "open_task_count": sum(1 for item in tasks if item.get("status") == "open"),
            "meeting_count": len(meetings),
            "unpaid_amount": finance["unpaid_amount"],
            "people_count": len(people),
        },
        "sections": sections,
        "pending_items": pending_items,
        "checklist": checklist,
        "tasks": tasks,
        "meetings": meetings,
        "calendar_events": calendar_events,
        "notifications": notifications,
        "people": people,
        "finance": finance,
        "procurement": procurement,
        "documents": documents,
        "suggestions": suggestions,
    }


async def spawn(
    db: AsyncSession,
    activity: Activity,
    data: ActivitySpawnCreate,
    *,
    actor,
) -> dict:
    org_id = activity.org_id
    if data.kind in {"meeting", "calendar_event", "document", "survey"} and org_id is None:
        raise ValueError("建立此項目需先設定活動所屬組織")

    if data.kind == "task":
        from api.schemas.work_item import WorkItemCreate
        from api.services import work_item as work_item_svc

        artifact = await work_item_svc.create_work_item(
            db,
            data=WorkItemCreate(
                title=data.title,
                description=data.description,
                source_type="activity",
                source_id=activity.id,
                due_at=data.due_at,
            ),
            created_by_id=actor.id,
        )
        kind = ActivityLinkKind.CALENDAR_EVENT
        href = f"/tasks?work_item={artifact.id}"
    elif data.kind == "meeting":
        from api.schemas.meeting import MeetingCreate
        from api.services import meeting as meeting_svc

        artifact = await meeting_svc.create_meeting(
            db,
            data=MeetingCreate(
                title=data.title,
                org_id=org_id,
                activity_id=activity.id,
                description=data.description,
                location=data.location,
                starts_at=data.starts_at,
                ends_at=data.ends_at,
            ),
            created_by=actor.id,
        )
        kind = ActivityLinkKind.MEETING
        href = f"/meetings/{artifact.id}"
    elif data.kind == "calendar_event":
        from api.models.calendar import CalendarEventType
        from api.schemas.calendar import CalendarEventCreate
        from api.services import calendar as calendar_svc

        starts_at = data.starts_at or activity.starts_at
        if starts_at is None:
            raise ValueError("建立行事曆事件需提供開始時間")
        artifact = await calendar_svc.create_event(
            db,
            data=CalendarEventCreate(
                title=data.title,
                org_id=org_id,
                description=data.description,
                event_type=CalendarEventType.ACTIVITY,
                starts_at=starts_at,
                ends_at=data.ends_at,
                location=data.location,
                links=[],
            ),
            actor=actor,
        )
        artifact.source_module = "activity"
        artifact.source_id = activity.id
        artifact.source_key = data.kind
        artifact.href = f"/activities/{activity.id}"
        kind = ActivityLinkKind.WORK_ITEM
        href = f"/calendar?event={artifact.id}"
    elif data.kind == "announcement":
        from api.schemas.announcement import AnnouncementCreate
        from api.services import announcement as announcement_svc

        artifact = await announcement_svc.create(
            db,
            author=actor,
            body=AnnouncementCreate(
                title=data.title,
                content={"type": "doc", "content": []},
                org_id=org_id,
                activity_id=activity.id,
            ),
        )
        kind = ActivityLinkKind.ANNOUNCEMENT
        href = f"/announcements/{artifact.id}"
    elif data.kind == "document":
        from api.schemas.document import DocumentCreate
        from api.services import document as document_svc

        artifact = await document_svc.create_document(
            db,
            data=DocumentCreate(
                title=data.title,
                org_id=org_id,
                activity_id=activity.id,
                subject=data.title,
                doc_description=data.description,
                content=data.description or "",
            ),
            created_by=actor.id,
        )
        kind = ActivityLinkKind.DOCUMENT
        href = f"/documents/{artifact.serial_number or artifact.id}"
    elif data.kind == "survey":
        from api.schemas.survey import SurveyCreate
        from api.services import survey as survey_svc

        artifact = await survey_svc.create_survey(
            db,
            data=SurveyCreate(
                title=data.title,
                description=data.description,
                org_id=org_id,
                activity_id=activity.id,
            ),
            created_by=actor.id,
        )
        kind = ActivityLinkKind.SURVEY
        href = f"/surveys/{artifact.id}"
    else:  # pragma: no cover
        raise ValueError("不支援的建立類型")

    link = await create_link(
        db,
        activity.id,
        ActivityLinkCreate(target_type=kind, target_id=artifact.id, title=data.title, href=href),
        actor_id=actor.id,
    )
    return {"kind": data.kind, "id": link.target_id, "title": data.title, "href": href}


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


def _link_item(link: ActivityLink) -> dict:
    return {
        "id": str(link.target_id),
        "link_id": str(link.id),
        "title": link.title,
        "href": link.href,
        "status": None,
        "timestamp": link.created_at,
        "note": link.note,
        "meta": link.meta,
    }


async def _tasks(db: AsyncSession, activity_id: uuid.UUID) -> list[dict]:
    rows = (
        await db.execute(
            select(WorkItem)
            .where(
                WorkItem.source_type == "activity",
                WorkItem.source_id == activity_id,
                WorkItem.is_active.is_(True),
            )
            .order_by(WorkItem.status.asc(), WorkItem.due_at.asc().nullslast())
            .limit(80)
        )
    ).scalars()
    return [
        {
            "id": str(row.id),
            "title": row.title,
            "href": f"/tasks?work_item={row.id}",
            "status": str(row.status),
            "due_at": row.due_at,
            "assigned_to_id": str(row.assigned_to_id) if row.assigned_to_id else None,
            "description": row.description,
        }
        for row in rows
    ]


async def _meetings(
    db: AsyncSession, activity_id: uuid.UUID, linked: list[ActivityLink]
) -> list[dict]:
    rows = (
        await db.execute(
            select(Meeting)
            .where(Meeting.activity_id == activity_id)
            .order_by(Meeting.starts_at.asc().nullslast(), Meeting.created_at.desc())
            .limit(80)
        )
    ).scalars()
    direct = [
        {
            "id": str(row.id),
            "title": row.title,
            "href": f"/meetings/{row.id}",
            "status": str(row.status),
            "starts_at": row.starts_at,
            "ends_at": row.ends_at,
            "location": row.location,
        }
        for row in rows
    ]
    seen = {item["id"] for item in direct}
    return direct + [_link_item(link) for link in linked if str(link.target_id) not in seen]


async def _calendar_events(db: AsyncSession, activity_id: uuid.UUID) -> list[dict]:
    rows = (
        await db.execute(
            select(CalendarEvent)
            .where(
                CalendarEvent.source_module == "activity",
                CalendarEvent.source_id == activity_id,
                CalendarEvent.is_active.is_(True),
            )
            .order_by(CalendarEvent.starts_at.asc())
            .limit(80)
        )
    ).scalars()
    return [
        {
            "id": str(row.id),
            "title": row.title,
            "href": row.href or f"/calendar?event={row.id}",
            "status": str(row.status),
            "starts_at": row.starts_at,
            "ends_at": row.ends_at,
            "location": row.location,
        }
        for row in rows
    ]


async def _notifications(
    db: AsyncSession, activity_id: uuid.UUID, grouped: dict[str, list[ActivityLink]]
) -> list[dict]:
    rows = (
        await db.execute(
            select(Announcement)
            .where(Announcement.activity_id == activity_id)
            .order_by(Announcement.created_at.desc())
            .limit(50)
        )
    ).scalars()
    direct = [
        {
            "id": str(row.id),
            "title": row.title,
            "href": f"/announcements/{row.id}",
            "status": "published" if row.is_published else "draft",
            "timestamp": row.published_at or row.created_at,
        }
        for row in rows
    ]
    seen = {item["id"] for item in direct}
    direct.extend(
        _link_item(link) for link in grouped["announcement"] if str(link.target_id) not in seen
    )
    direct.extend(_link_item(link) for link in grouped["publication"])
    return direct


async def _finance_summary(db: AsyncSession, activity_id: uuid.UUID) -> dict:
    rows = (
        await db.execute(
            select(
                Receivable.status,
                func.count(Receivable.id).label("count"),
                func.coalesce(func.sum(Receivable.amount), 0).label("amount"),
                func.coalesce(func.sum(Receivable.paid_amount), 0).label("paid"),
            )
            .where(Receivable.activity_id == activity_id)
            .group_by(Receivable.status)
        )
    ).all()
    total = sum(int(row.amount or 0) for row in rows)
    paid = sum(int(row.paid or 0) for row in rows)
    return {
        "total_amount": total,
        "paid_amount": paid,
        "unpaid_amount": max(total - paid, 0),
        "by_status": {
            str(row.status): {"count": int(row.count), "amount": int(row.amount or 0)}
            for row in rows
        },
    }


async def _procurement(
    db: AsyncSession, activity_id: uuid.UUID, grouped: dict[str, list[ActivityLink]]
) -> list[dict]:
    products = (
        await db.execute(
            select(Product)
            .where(Product.activity_id == activity_id)
            .order_by(Product.created_at.desc())
            .limit(40)
        )
    ).scalars()
    items = [
        {
            "id": str(row.id),
            "title": row.name,
            "href": f"/shop/admin?product={row.id}",
            "status": "product",
            "timestamp": row.created_at,
        }
        for row in products
    ]
    seen = {item["id"] for item in items}
    items.extend(
        _link_item(link) for link in grouped["shop_product"] if str(link.target_id) not in seen
    )
    items.extend(_link_item(link) for link in grouped["shop_order"])
    items.extend(_link_item(link) for link in grouped["meal_schedule"])
    items.extend(_link_item(link) for link in grouped["meal_order"])
    return items


async def _documents(
    db: AsyncSession, activity_id: uuid.UUID, grouped: dict[str, list[ActivityLink]]
) -> list[dict]:
    rows = (
        await db.execute(
            select(Document)
            .where(Document.activity_id == activity_id)
            .order_by(Document.created_at.desc())
            .limit(60)
        )
    ).scalars()
    direct = [
        {
            "id": str(row.id),
            "title": row.title or "公文",
            "href": f"/documents/{row.serial_number or row.id}",
            "status": str(row.status),
            "timestamp": row.created_at,
        }
        for row in rows
    ]
    seen = {item["id"] for item in direct}
    for key in ("document", "regulation", "survey", "petition"):
        direct.extend(_link_item(link) for link in grouped[key] if str(link.target_id) not in seen)
    return direct


def _people(activity: Activity) -> list[dict]:
    return [
        {
            "id": str(convener.user_id),
            "role": "總召",
            "user_id": str(convener.user_id),
            "start_date": convener.start_date,
            "end_date": convener.end_date,
        }
        for convener in getattr(activity, "conveners", [])
    ]


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
