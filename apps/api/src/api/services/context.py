"""使用者情境脈絡聚合服務。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity
from api.models.activity_link import ActivityLink
from api.models.announcement import Announcement
from api.models.document import Document, DocumentApproval
from api.models.governance import EntityRelation, Matter
from api.models.meeting import Meeting, MeetingAgendaItem, MeetingAttendance
from api.models.petition import PetitionCase
from api.models.regulation import Regulation
from api.models.user import User
from api.schemas.context import (
    ContextLink,
    DocumentApprovalContextOut,
    MeetingBriefingCardOut,
    PetitionResolutionContextOut,
    RegulationUsageContextOut,
)


async def meeting_briefing_card(
    db: AsyncSession, meeting_id: uuid.UUID, user: User
) -> MeetingBriefingCardOut:
    meeting = await db.get(Meeting, meeting_id)
    if meeting is None:
        raise ValueError("會議不存在")
    attendance = await db.scalar(
        select(MeetingAttendance).where(
            MeetingAttendance.meeting_id == meeting_id,
            MeetingAttendance.user_id == user.id,
        )
    )
    agenda = (
        await db.execute(
            select(MeetingAgendaItem)
            .where(MeetingAgendaItem.meeting_id == meeting_id)
            .order_by(MeetingAgendaItem.order_index.asc())
            .limit(10)
        )
    ).scalars()
    related = await _links_for(db, "meeting", meeting_id)
    actions = ["確認議程資料與出席狀態"]
    if attendance is None:
        actions.append("確認是否需要加入會議出席名冊")
    return MeetingBriefingCardOut(
        meeting_id=meeting_id,
        my_role=getattr(attendance, "role", None),
        attendance_status=getattr(attendance, "status", None),
        agenda_items=[
            ContextLink(
                title=item.title,
                href=f"/meetings/{meeting_id}",
                kind="agenda_item",
                timestamp=item.created_at,
            )
            for item in agenda
        ],
        related_items=related,
        recommended_actions=actions,
    )


async def document_approval_context(
    db: AsyncSession, document_id: uuid.UUID
) -> DocumentApprovalContextOut:
    document = await db.get(Document, document_id)
    if document is None:
        raise ValueError("公文不存在")
    activity_link = None
    if document.activity_id:
        activity = await db.get(Activity, document.activity_id)
        if activity:
            activity_link = ContextLink(
                title=activity.name,
                href=f"/activities/{activity.id}",
                kind="activity",
                timestamp=activity.starts_at,
            )
    approvals = (
        await db.execute(
            select(DocumentApproval)
            .where(DocumentApproval.document_id == document.id)
            .order_by(DocumentApproval.step_order.asc())
        )
    ).scalars()
    comments = [a.comment for a in approvals if getattr(a, "comment", None)]
    return DocumentApprovalContextOut(
        document_id=document.id,
        source_activity=activity_link,
        related_items=await _links_for(db, "document", document.id),
        previous_comments=comments,
        recommended_actions=[
            "確認前關意見與附件",
            "核對相關法規或活動需求",
            "若內容需修正，退回並留下具體修改原因",
        ],
    )


async def petition_resolution_context(
    db: AsyncSession, petition_id: uuid.UUID
) -> PetitionResolutionContextOut:
    petition = await db.get(PetitionCase, petition_id)
    if petition is None:
        raise ValueError("陳情不存在")
    keyword = f"%{petition.title[:12]}%" if petition.title else "%"
    regs = (
        await db.execute(select(Regulation).where(Regulation.title.ilike(keyword)).limit(5))
    ).scalars()
    similar = (
        await db.execute(
            select(PetitionCase)
            .where(PetitionCase.id != petition.id, PetitionCase.title.ilike(keyword))
            .limit(5)
        )
    ).scalars()
    activities = (
        await db.execute(select(Activity).where(Activity.name.ilike(keyword)).limit(5))
    ).scalars()
    return PetitionResolutionContextOut(
        petition_id=petition.id,
        related_regulations=[
            ContextLink(title=r.title, href=f"/regulations/{r.id}", kind="regulation") for r in regs
        ],
        similar_petitions=[
            ContextLink(title=p.title, href=f"/petitions/{p.case_number}", kind="petition")
            for p in similar
        ],
        related_activities=[
            ContextLink(title=a.name, href=f"/activities/{a.id}", kind="activity")
            for a in activities
        ],
        recommended_actions=[
            "確認是否需補件",
            "判斷是否轉派其他組織",
            "必要時建立公文草稿或排入會議議程",
        ],
    )


async def regulation_usage_context(
    db: AsyncSession, regulation_id: uuid.UUID
) -> RegulationUsageContextOut:
    regulation = await db.get(Regulation, regulation_id)
    if regulation is None:
        raise ValueError("法規不存在")
    keyword = f"%{regulation.title[:12]}%"
    docs = (
        await db.execute(select(Document).where(Document.title.ilike(keyword)).limit(8))
    ).scalars()
    meetings = (
        await db.execute(select(Meeting).where(Meeting.title.ilike(keyword)).limit(8))
    ).scalars()
    petitions = (
        await db.execute(select(PetitionCase).where(PetitionCase.title.ilike(keyword)).limit(8))
    ).scalars()
    anns = (
        await db.execute(select(Announcement).where(Announcement.title.ilike(keyword)).limit(8))
    ).scalars()
    return RegulationUsageContextOut(
        regulation_id=regulation.id,
        related_documents=[
            ContextLink(
                title=d.title or "公文",
                href=f"/documents/{d.serial_number or d.id}",
                kind="document",
            )
            for d in docs
        ],
        related_meetings=[
            ContextLink(title=m.title, href=f"/meetings/{m.id}", kind="meeting") for m in meetings
        ],
        related_petitions=[
            ContextLink(title=p.title, href=f"/petitions/{p.case_number}", kind="petition")
            for p in petitions
        ],
        related_announcements=[
            ContextLink(title=a.title, href=f"/announcements/{a.id}", kind="announcement")
            for a in anns
        ],
        pending_reviews=[],
    )


async def _links_for(db: AsyncSession, target_type: str, target_id: uuid.UUID) -> list[ContextLink]:
    matter_rows = (
        await db.execute(
            select(EntityRelation, Matter)
            .join(Matter, EntityRelation.matter_id == Matter.id)
            .where(
                EntityRelation.target_type == target_type,
                EntityRelation.target_id == target_id,
                Matter.is_active.is_(True),
            )
            .order_by(EntityRelation.updated_at.desc())
        )
    ).all()
    rows = (
        await db.execute(
            select(ActivityLink).where(
                ActivityLink.target_type == target_type,
                ActivityLink.target_id == target_id,
            )
        )
    ).scalars()
    links = [
        ContextLink(
            title=matter.title,
            href=f"/matters/{matter.id}",
            kind=relation.relation,
            timestamp=relation.created_at,
        )
        for relation, matter in matter_rows
    ]
    links.extend(
        [
            ContextLink(
                title=row.title,
                href=f"/activities/{row.activity_id}",
                kind="activity_link",
                timestamp=row.created_at,
            )
            for row in rows
        ]
    )
    return links
