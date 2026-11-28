"""使用者情境脈絡聚合服務。"""

from __future__ import annotations

import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from api.core.search import LIKE_ESCAPE, like_contains
from api.models.announcement import Announcement, AnnouncementAudience
from api.models.document import (
    Document,
    DocumentApproval,
    DocumentClassification,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.petition import PetitionCase, PetitionPublicStatus, PetitionStatus
from api.models.regulation import Regulation
from api.models.user import User
from api.schemas.context import (
    ContextLink,
    DocumentApprovalContextOut,
    PetitionResolutionContextOut,
    RegulationUsageContextOut,
)


async def document_approval_context(
    db: AsyncSession, document_id: uuid.UUID
) -> DocumentApprovalContextOut:
    document = await db.get(Document, document_id)
    if document is None:
        raise ValueError("公文不存在")
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
        previous_comments=comments,
        recommended_actions=[
            "確認前關意見與附件",
            "核對相關法規或活動需求",
            "若內容需修正，退回並留下具體修改原因",
        ],
    )


async def petition_resolution_context(
    db: AsyncSession, petition_id: uuid.UUID, *, viewer: User | None = None
) -> PetitionResolutionContextOut:
    petition = await db.get(PetitionCase, petition_id)
    if petition is None:
        raise ValueError("陳情不存在")
    keyword = like_contains(petition.title[:12]) if petition.title else None
    regs = (
        (
            await db.execute(
                select(Regulation)
                .options(load_only(Regulation.id, Regulation.title))
                .where(Regulation.title.ilike(keyword, escape=LIKE_ESCAPE))
                .limit(5)
            )
        ).scalars()
        if keyword
        else []
    )
    public_case = and_(
        PetitionCase.status == PetitionStatus.CLOSED,
        PetitionCase.public_status == PetitionPublicStatus.PUBLISHED,
        PetitionCase.is_confidential.is_(False),
    )
    public_title_match = and_(
        public_case,
        func.coalesce(PetitionCase.public_title, PetitionCase.title).ilike(
            keyword, escape=LIKE_ESCAPE
        )
        if keyword
        else False,
    )
    visible_matches = [public_title_match]
    if viewer is not None and keyword:
        from api.services.petition import is_site_owner

        if is_site_owner(viewer):
            visible_matches = [PetitionCase.title.ilike(keyword, escape=LIKE_ESCAPE)]
        else:
            visible_matches.append(
                and_(
                    or_(
                        PetitionCase.submitter_id == viewer.id,
                        PetitionCase.assigned_to_id == viewer.id,
                    ),
                    PetitionCase.title.ilike(keyword, escape=LIKE_ESCAPE),
                )
            )
    similar_query = select(PetitionCase).where(
        PetitionCase.id != petition.id,
        or_(*visible_matches),
    )
    similar = (await db.execute(similar_query.limit(5))).scalars()
    return PetitionResolutionContextOut(
        petition_id=petition.id,
        related_regulations=[
            ContextLink(title=r.title, href=f"/regulations/{r.id}", kind="regulation") for r in regs
        ],
        similar_petitions=[
            ContextLink(
                title=p.public_title or p.title,
                href=f"/petitions/{p.case_number}",
                kind="petition",
            )
            for p in similar
        ],
        recommended_actions=[
            "確認是否需補件",
            "判斷是否轉派其他組織",
            "必要時建立公文草稿",
        ],
    )


async def regulation_usage_context(
    db: AsyncSession, regulation_id: uuid.UUID
) -> RegulationUsageContextOut:
    regulation = await db.get(Regulation, regulation_id)
    if regulation is None:
        raise ValueError("法規不存在")
    keyword = like_contains(regulation.title[:12])
    docs = (
        await db.execute(
            select(Document)
            .where(
                Document.title.ilike(keyword, escape=LIKE_ESCAPE),
                Document.status == DocumentStatus.APPROVED,
                Document.classification == DocumentClassification.NORMAL,
                or_(
                    Document.visibility_level == DocumentVisibility.PUBLICLY_OPEN,
                    Document.is_public.is_(True),
                ),
            )
            .limit(8)
        )
    ).scalars()
    petitions = (
        await db.execute(
            select(PetitionCase)
            .where(
                func.coalesce(PetitionCase.public_title, PetitionCase.title).ilike(
                    keyword, escape=LIKE_ESCAPE
                ),
                PetitionCase.status == PetitionStatus.CLOSED,
                PetitionCase.public_status == PetitionPublicStatus.PUBLISHED,
                PetitionCase.is_confidential.is_(False),
            )
            .limit(8)
        )
    ).scalars()
    anns = (
        await db.execute(
            select(Announcement)
            .where(
                Announcement.title.ilike(keyword, escape=LIKE_ESCAPE),
                Announcement.is_published.is_(True),
                Announcement.audience_type == AnnouncementAudience.ALL.value,
            )
            .limit(8)
        )
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
        related_petitions=[
            ContextLink(
                title=p.public_title or p.title, href=f"/petitions/{p.case_number}", kind="petition"
            )
            for p in petitions
        ],
        related_announcements=[
            ContextLink(title=a.title, href=f"/announcements/{a.id}", kind="announcement")
            for a in anns
        ],
    )
