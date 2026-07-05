"""治理事情中心的模組能力清單與跨模組資源搜尋。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import String, cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity
from api.models.announcement import Announcement
from api.models.calendar import CalendarEvent
from api.models.council_proposal import CouncilProposal
from api.models.document import Document
from api.models.exam_paper import ExamPaper
from api.models.judicial_petition import JudicialPetition
from api.models.meal import MealVendor
from api.models.meeting import Meeting
from api.models.org import Org, Position
from api.models.partner_map import PartnerBusiness
from api.models.person import Person
from api.models.petition import PetitionCase
from api.models.publication import PublicationCampaign
from api.models.receivable import Receivable
from api.models.regulation import Regulation
from api.models.school_class import SchoolClass
from api.models.shop import Order, Product
from api.models.survey import Survey

MODULE_CAPABILITIES: tuple[dict[str, Any], ...] = (
    {
        "key": "task",
        "label": "任務",
        "category": "執行",
        "icon": "check-square",
        "href": "/tasks",
        "create_mode": "quick",
        "searchable": False,
    },
    {
        "key": "announcement",
        "label": "公告",
        "category": "溝通",
        "icon": "megaphone",
        "href": "/announcements/new",
        "create_mode": "guided",
        "searchable": True,
        "permission_codes": ["announcement:create"],
    },
    {
        "key": "survey",
        "label": "問卷",
        "category": "溝通",
        "icon": "clipboard-list",
        "href": "/surveys/new",
        "create_mode": "guided",
        "searchable": True,
        "requires_org": True,
    },
    {
        "key": "meeting",
        "label": "會議",
        "category": "治理",
        "icon": "users",
        "href": "/meetings",
        "create_mode": "guided",
        "searchable": True,
        "requires_org": True,
        "permission_codes": ["meeting:create", "meeting:manage"],
    },
    {
        "key": "document",
        "label": "公文",
        "category": "治理",
        "icon": "file-text",
        "href": "/documents/new",
        "create_mode": "guided",
        "searchable": True,
        "requires_org": True,
        "permission_codes": ["document:create", "document:draft", "document:admin"],
    },
    {
        "key": "regulation",
        "label": "法規草案",
        "category": "治理",
        "icon": "scale",
        "href": "/regulations/new",
        "create_mode": "guided",
        "searchable": True,
        "requires_org": True,
        "permission_codes": ["regulation:create"],
    },
    {
        "key": "activity",
        "label": "活動",
        "category": "執行",
        "icon": "calendar-days",
        "href": "/admin/activities",
        "create_mode": "guided",
        "searchable": True,
    },
    {
        "key": "council_proposal",
        "label": "議會提案",
        "category": "治理",
        "icon": "landmark",
        "href": "/council-proposals",
        "create_mode": "guided",
        "searchable": True,
    },
    {
        "key": "judicial_petition",
        "label": "評議聲請",
        "category": "治理",
        "icon": "gavel",
        "href": "/judicial-petitions",
        "create_mode": "guided",
        "searchable": True,
    },
    {
        "key": "petition",
        "label": "陳情",
        "category": "治理",
        "icon": "message-square",
        "href": "/petitions/new",
        "create_mode": "guided",
        "searchable": True,
    },
    {
        "key": "election",
        "label": "選舉",
        "category": "治理",
        "icon": "vote",
        "href": "/admin/elections/new",
        "create_mode": "guided",
        "searchable": False,
    },
    {
        "key": "product",
        "label": "購票商品",
        "category": "服務",
        "icon": "ticket",
        "href": "/shop/admin",
        "create_mode": "guided",
        "searchable": True,
    },
    {
        "key": "meal_schedule",
        "label": "學餐排程",
        "category": "服務",
        "icon": "utensils",
        "href": "/meal",
        "create_mode": "guided",
        "searchable": False,
    },
    {
        "key": "email_message",
        "label": "郵件",
        "category": "溝通",
        "icon": "mail",
        "href": "/email",
        "create_mode": "guided",
        "searchable": False,
    },
    {
        "key": "publication",
        "label": "發布任務",
        "category": "溝通",
        "icon": "send",
        "href": "/publications",
        "create_mode": "guided",
        "searchable": True,
    },
    {
        "key": "calendar_event",
        "label": "行事曆",
        "category": "執行",
        "icon": "calendar",
        "href": "/calendar",
        "create_mode": "guided",
        "searchable": True,
    },
    {
        "key": "exam_paper",
        "label": "試卷",
        "category": "服務",
        "icon": "file-check",
        "href": "/exam-papers",
        "create_mode": "guided",
        "searchable": True,
    },
    {
        "key": "order",
        "label": "購票訂單",
        "category": "資料",
        "icon": "receipt",
        "href": "/shop/orders",
        "create_mode": "link",
        "searchable": True,
    },
    {
        "key": "receivable",
        "label": "收款",
        "category": "資料",
        "icon": "badge-dollar-sign",
        "href": "/finance/receivables",
        "create_mode": "link",
        "searchable": True,
    },
    {
        "key": "org",
        "label": "組織",
        "category": "資料",
        "icon": "building",
        "href": "/orgs",
        "create_mode": "link",
        "searchable": True,
    },
    {
        "key": "person",
        "label": "人員",
        "category": "資料",
        "icon": "user",
        "href": "/admin/people",
        "create_mode": "link",
        "searchable": True,
    },
    {
        "key": "position",
        "label": "職位",
        "category": "資料",
        "icon": "briefcase",
        "href": "/orgs",
        "create_mode": "link",
        "searchable": True,
    },
    {
        "key": "school_class",
        "label": "班級",
        "category": "資料",
        "icon": "school",
        "href": "/admin/classes",
        "create_mode": "link",
        "searchable": True,
    },
    {
        "key": "meal_vendor",
        "label": "餐商",
        "category": "資料",
        "icon": "store",
        "href": "/meal",
        "create_mode": "link",
        "searchable": True,
    },
    {
        "key": "partner_business",
        "label": "特約商家",
        "category": "資料",
        "icon": "map-pin",
        "href": "/partner-map",
        "create_mode": "link",
        "searchable": True,
    },
)


@dataclass(frozen=True)
class SearchSpec:
    model: Any
    title: Any
    summary: Any | None
    status: Any | None
    href_prefix: str


SEARCH_SPECS: dict[str, SearchSpec] = {
    "document": SearchSpec(
        Document, Document.title, Document.content, Document.status, "/documents/"
    ),
    "regulation": SearchSpec(
        Regulation,
        Regulation.title,
        Regulation.content,
        Regulation.workflow_status,
        "/regulations/",
    ),
    "meeting": SearchSpec(
        Meeting, Meeting.title, Meeting.description, Meeting.status, "/meetings/"
    ),
    "announcement": SearchSpec(Announcement, Announcement.title, None, None, "/announcements/"),
    "survey": SearchSpec(Survey, Survey.title, Survey.description, Survey.status, "/surveys/"),
    "activity": SearchSpec(
        Activity, Activity.name, Activity.description, Activity.status, "/activities/"
    ),
    "council_proposal": SearchSpec(
        CouncilProposal,
        CouncilProposal.title,
        CouncilProposal.summary,
        CouncilProposal.status,
        "/council-proposals/",
    ),
    "judicial_petition": SearchSpec(
        JudicialPetition,
        JudicialPetition.title,
        JudicialPetition.facts_and_reasons,
        JudicialPetition.status,
        "/judicial-petitions/",
    ),
    "petition": SearchSpec(
        PetitionCase, PetitionCase.title, PetitionCase.content, PetitionCase.status, "/petitions/"
    ),
    "product": SearchSpec(
        Product, Product.name, Product.description, Product.status, "/shop/admin?product="
    ),
    "publication": SearchSpec(
        PublicationCampaign,
        PublicationCampaign.title,
        PublicationCampaign.body,
        PublicationCampaign.status,
        "/publications/",
    ),
    "calendar_event": SearchSpec(
        CalendarEvent,
        CalendarEvent.title,
        CalendarEvent.description,
        CalendarEvent.status,
        "/calendar?event=",
    ),
    "exam_paper": SearchSpec(ExamPaper, ExamPaper.title, ExamPaper.subject, None, "/exam-papers/"),
    "order": SearchSpec(Order, Order.serial_number, Order.notes, Order.status, "/shop/orders/"),
    "receivable": SearchSpec(
        Receivable,
        Receivable.title,
        Receivable.note,
        Receivable.status,
        "/finance/receivables?item=",
    ),
    "org": SearchSpec(Org, Org.name, Org.description, None, "/orgs/"),
    "person": SearchSpec(
        Person, Person.display_name, Person.email, Person.status, "/admin/people?person="
    ),
    "position": SearchSpec(Position, Position.name, Position.description, None, "/orgs?position="),
    "school_class": SearchSpec(
        SchoolClass, SchoolClass.label, SchoolClass.class_code, None, "/admin/classes/"
    ),
    "meal_vendor": SearchSpec(
        MealVendor, MealVendor.name, MealVendor.description, MealVendor.status, "/meal/vendors/"
    ),
    "partner_business": SearchSpec(
        PartnerBusiness,
        PartnerBusiness.name,
        PartnerBusiness.summary,
        PartnerBusiness.status,
        "/partner-map/",
    ),
}


async def search_resources(
    db: AsyncSession, *, kind: str, query: str, limit: int
) -> list[dict[str, Any]]:
    spec = SEARCH_SPECS.get(kind)
    if spec is None:
        return []
    q = query.replace("\x00", "").strip()
    stmt = select(spec.model)
    if q:
        pattern = f"%{q}%"
        conditions = [cast(spec.title, String).ilike(pattern)]
        if spec.summary is not None:
            conditions.append(cast(spec.summary, String).ilike(pattern))
        stmt = stmt.where(or_(*conditions))
    rows = (await db.execute(stmt.order_by(spec.model.updated_at.desc()).limit(limit))).scalars()
    results: list[dict[str, Any]] = []
    for row in rows:
        title = getattr(row, spec.title.key, None) or row.id
        summary = getattr(row, spec.summary.key, "") if spec.summary is not None else ""
        state = getattr(row, spec.status.key, None) if spec.status is not None else None
        results.append(
            {
                "id": row.id,
                "kind": kind,
                "title": str(title),
                "summary": str(summary or "")[:240],
                "status": str(getattr(state, "value", state)) if state is not None else None,
                "href": f"{spec.href_prefix}{row.id}",
            }
        )
    return results
