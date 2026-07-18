"""法規與公布令一致性檢查服務。"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import Document, DocumentCategory
from api.models.regulation import Regulation, RegulationWorkflowStatus

logger = logging.getLogger(__name__)

_CHUNK = 50


async def audit_regulation_document_consistency(session: AsyncSession) -> dict[str, Any]:
    """巡檢法規與公布令的雙向一致性（分批 50 筆，避免長事務）。"""
    problems: list[dict[str, str]] = []

    # ── 第一輪：PUBLISHED 法規 ──────────────────────────────────────────────
    reg_offset = 0
    total_regs = 0
    while True:
        chunk = (
            (
                await session.execute(
                    select(Regulation)
                    .where(Regulation.workflow_status == RegulationWorkflowStatus.PUBLISHED)
                    .limit(_CHUNK)
                    .offset(reg_offset)
                )
            )
            .scalars()
            .all()
        )
        if not chunk:
            break

        doc_ids = [r.published_document_id for r in chunk if r.published_document_id]
        docs_by_id: dict = {}
        if doc_ids:
            rows = (
                (await session.execute(select(Document).where(Document.id.in_(doc_ids))))
                .scalars()
                .all()
            )
            docs_by_id = {d.id: d for d in rows}

        for reg in chunk:
            if reg.published_document_id is None:
                problems.append(
                    {"type": "published_regulation_missing_document", "regulation_id": str(reg.id)}
                )
                continue
            doc = docs_by_id.get(reg.published_document_id)
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

        total_regs += len(chunk)
        logger.debug("regulation_consistency: 已處理 %d 筆法規", total_regs)
        reg_offset += _CHUNK
        if len(chunk) < _CHUNK:
            break

    # ── 第二輪：公布令文件 ────────────────────────────────────────────────
    doc_offset = 0
    total_docs = 0
    while True:
        chunk_docs = (
            (
                await session.execute(
                    select(Document)
                    .where(Document.category == DocumentCategory.DECREE)
                    .limit(_CHUNK)
                    .offset(doc_offset)
                )
            )
            .scalars()
            .all()
        )
        if not chunk_docs:
            break

        reg_ids = [d.regulation_id for d in chunk_docs if d.regulation_id]
        regs_by_id: dict = {}
        if reg_ids:
            rows = (
                (await session.execute(select(Regulation).where(Regulation.id.in_(reg_ids))))
                .scalars()
                .all()
            )
            regs_by_id = {r.id: r for r in rows}

        for doc in chunk_docs:
            if doc.regulation_id is None:
                problems.append(
                    {"type": "decree_missing_regulation_id", "document_id": str(doc.id)}
                )
                continue
            reg = regs_by_id.get(doc.regulation_id)
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

        total_docs += len(chunk_docs)
        logger.debug("regulation_consistency: 已處理 %d 筆公布令", total_docs)
        doc_offset += _CHUNK
        if len(chunk_docs) < _CHUNK:
            break

    logger.info(
        "regulation_consistency 完成：法規 %d 筆、公布令 %d 筆，問題 %d 項",
        total_regs,
        total_docs,
        len(problems),
    )
    return {
        "checked_at": datetime.now(UTC).isoformat(),
        "problem_count": len(problems),
        "problems": problems,
    }
