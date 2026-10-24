"""公文審核的完整動作：狀態轉移、下一關通知與正式發文遞送。

HTTP 單筆、批量與 Discord 共用此入口；各入口仍負責 RBAC、稽核來源與回應。
底層狀態機保留審核人、代理、鎖定與狀態檢查，不在此繞過。
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import Document, DocumentStatus
from api.schemas.document import RejectMode
from api.services.discord_bot import emit_public_document_notice
from api.services.document._access import _doc_query_with_relations
from api.services.document._delivery import queue_document_recipient_emails
from api.services.document._lifecycle import (
    approve_step,
    issue_document_directly,
    reject_step,
    reject_to_previous_step,
    submit_document,
)
from api.services.notification import create_notification


async def _load_after_transition(session: AsyncSession, doc: Document) -> Document:
    """在同一交易重新載入關聯，包含狀態轉移時新增或更新的代理與審核步驟。"""
    result = await session.execute(
        _doc_query_with_relations()
        .where(Document.id == doc.id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _notify_current_approver(
    session: AsyncSession, doc: Document, *, title_prefix: str
) -> None:
    step = next((step for step in doc.approvals if step.step_order == doc.current_step), None)
    if step is not None:
        await create_notification(
            session,
            user_id=step.delegate_id or step.approver_id,
            type="document_pending",
            title=f"{title_prefix}{doc.title}",
            body=f"字號：{doc.serial_number}",
            link=f"/documents/{doc.id}",
            related_id=doc.id,
        )


async def _complete_issuance(session: AsyncSession, doc: Document, *, title_prefix: str) -> None:
    # 正式受文遞送獨立於承辦人的一般通知偏好；由既有遞送流程去重。
    await queue_document_recipient_emails(session, doc)
    await create_notification(
        session,
        user_id=doc.created_by,
        type="document_approved",
        title=f"{title_prefix}{doc.title}",
        body=f"字號：{doc.serial_number}",
        link=f"/documents/{doc.id}",
        related_id=doc.id,
    )
    await emit_public_document_notice(session, doc)


async def submit_for_approval(
    session: AsyncSession, doc: Document, *, approver_ids: list[uuid.UUID]
) -> Document:
    updated = await submit_document(session, doc, approver_ids=approver_ids)
    updated = await _load_after_transition(session, updated)
    await _notify_current_approver(session, updated, title_prefix="公文待你審核：")
    return updated


async def approve_document(
    session: AsyncSession,
    doc: Document,
    *,
    approver_id: uuid.UUID,
    comment: str | None = None,
) -> Document:
    updated = await approve_step(session, doc, approver_id=approver_id, comment=comment)
    updated = await _load_after_transition(session, updated)
    if updated.status == DocumentStatus.APPROVED:
        await _complete_issuance(session, updated, title_prefix="公文已核准：")
    else:
        await _notify_current_approver(session, updated, title_prefix="公文待你審核：")
    return updated


async def reject_document(
    session: AsyncSession,
    doc: Document,
    *,
    approver_id: uuid.UUID,
    comment: str,
    mode: RejectMode,
) -> Document:
    if mode == RejectMode.TO_PREVIOUS:
        updated = await reject_to_previous_step(
            session, doc, approver_id=approver_id, comment=comment
        )
    else:
        updated = await reject_step(session, doc, approver_id=approver_id, comment=comment)
    updated = await _load_after_transition(session, updated)
    if mode == RejectMode.TO_PREVIOUS:
        await _notify_current_approver(session, updated, title_prefix="公文退回待你重審：")
    else:
        await create_notification(
            session,
            user_id=updated.created_by,
            type="document_rejected",
            title=f"公文被退件：{updated.title}",
            body=f"字號：{updated.serial_number}",
            link=f"/documents/{updated.id}",
            related_id=updated.id,
        )
    return updated


async def issue_document(
    session: AsyncSession,
    doc: Document,
    *,
    issued_by: uuid.UUID,
    comment: str | None = None,
) -> Document:
    updated = await issue_document_directly(session, doc, issued_by=issued_by, comment=comment)
    updated = await _load_after_transition(session, updated)
    await _complete_issuance(session, updated, title_prefix="公文已直接發文：")
    return updated
