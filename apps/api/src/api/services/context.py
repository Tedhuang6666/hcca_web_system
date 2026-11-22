"""使用者情境脈絡聚合服務。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from api.models.announcement import Announcement
from api.models.document import Document, DocumentApproval
from api.models.petition import PetitionCase
from api.models.regulation import Regulation
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
    db: AsyncSession, petition_id: uuid.UUID
) -> PetitionResolutionContextOut:
    petition = await db.get(PetitionCase, petition_id)
    if petition is None:
        raise ValueError("陳情不存在")
    keyword = f"%{petition.title[:12]}%" if petition.title else "%"
    regs = (
        await db.execute(
            select(Regulation)
            .options(load_only(Regulation.id, Regulation.title))
            .where(Regulation.title.ilike(keyword))
            .limit(5)
        )
    ).scalars()
    similar = (
        await db.execute(
            select(PetitionCase)
            .where(PetitionCase.id != petition.id, PetitionCase.title.ilike(keyword))
            .limit(5)
        )
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
    keyword = f"%{regulation.title[:12]}%"
    docs = (
        await db.execute(select(Document).where(Document.title.ilike(keyword)).limit(8))
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
        related_petitions=[
            ContextLink(title=p.title, href=f"/petitions/{p.case_number}", kind="petition")
            for p in petitions
        ],
        related_announcements=[
            ContextLink(title=a.title, href=f"/announcements/{a.id}", kind="announcement")
            for a in anns
        ],
    )
