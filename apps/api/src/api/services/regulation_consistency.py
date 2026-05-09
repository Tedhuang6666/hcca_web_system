"""法規與公布令一致性檢查服務。"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import Document, DocumentCategory
from api.models.regulation import Regulation, RegulationWorkflowStatus


async def audit_regulation_document_consistency(session: AsyncSession) -> dict[str, Any]:
    """巡檢法規與公布令的雙向一致性。"""
    problems: list[dict[str, str]] = []

    published_regs_stmt: Select[tuple[Regulation]] = select(Regulation).where(
        Regulation.workflow_status == RegulationWorkflowStatus.PUBLISHED
    )
    published_regs = (await session.execute(published_regs_stmt)).scalars().all()

    for reg in published_regs:
        if reg.published_document_id is None:
            problems.append(
                {
                    "type": "published_regulation_missing_document",
                    "regulation_id": str(reg.id),
                }
            )
            continue

        doc = await session.get(Document, reg.published_document_id)
        if doc is None:
            problems.append(
                {
                    "type": "published_document_not_found",
                    "regulation_id": str(reg.id),
                    "document_id": str(reg.published_document_id),
                }
            )
            continue
        if doc.category != DocumentCategory.DECREE:
            problems.append(
                {
                    "type": "published_document_not_decree",
                    "regulation_id": str(reg.id),
                    "document_id": str(doc.id),
                }
            )
        if doc.regulation_id != reg.id:
            problems.append(
                {
                    "type": "published_document_wrong_link",
                    "regulation_id": str(reg.id),
                    "document_id": str(doc.id),
                }
            )

    decree_docs_stmt: Select[tuple[Document]] = select(Document).where(
        Document.category == DocumentCategory.DECREE
    )
    decree_docs = (await session.execute(decree_docs_stmt)).scalars().all()
    for doc in decree_docs:
        if doc.regulation_id is None:
            problems.append(
                {
                    "type": "decree_missing_regulation_id",
                    "document_id": str(doc.id),
                }
            )
            continue
        reg = await session.get(Regulation, doc.regulation_id)
        if reg is None:
            problems.append(
                {
                    "type": "decree_regulation_not_found",
                    "document_id": str(doc.id),
                    "regulation_id": str(doc.regulation_id),
                }
            )
            continue
        if reg.published_document_id != doc.id:
            problems.append(
                {
                    "type": "decree_not_bound_as_published_document",
                    "document_id": str(doc.id),
                    "regulation_id": str(reg.id),
                }
            )

    return {
        "checked_at": datetime.now(UTC).isoformat(),
        "problem_count": len(problems),
        "problems": problems,
    }
