"""公文可見性 / 存取控制 / 查詢輔助"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.core.search import like_contains
from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
    DocumentClassification,
    DocumentRecipient,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.user import User
from api.schemas.document import DocumentListItem
from api.services.permission import active_tenure_filter

REDACTED_CONFIDENTIAL_TEXT = "(此公文為密件)"
SENSITIVE_DOCUMENT_CLASSIFICATIONS = frozenset(
    {DocumentClassification.CONFIDENTIAL, DocumentClassification.SECRET}
)


def _active_assignment_exists_for_viewer(
    *,
    viewer_id: uuid.UUID,
    at: datetime | None = None,
):
    current = at or datetime.now(UTC)
    return exists(
        select(1).where(
            DocumentApprovalDelegation.principal_user_id == DocumentApproval.approver_id,
            DocumentApprovalDelegation.delegate_user_id == viewer_id,
            DocumentApprovalDelegation.org_id == Document.org_id,
            DocumentApprovalDelegation.is_active.is_(True),
            DocumentApprovalDelegation.start_at <= current,
            or_(
                DocumentApprovalDelegation.end_at.is_(None),
                DocumentApprovalDelegation.end_at >= current,
            ),
        )
    )


def _doc_query_for_list():
    return select(Document).options(
        selectinload(Document.creator),
        selectinload(Document.org),
    )


def _doc_query_with_relations():
    return select(Document).options(
        selectinload(Document.org),
        selectinload(Document.revisions),
        selectinload(Document.approvals).selectinload(DocumentApproval.approver),
        selectinload(Document.approvals).selectinload(DocumentApproval.delegate),
        selectinload(Document.attachments),
        selectinload(Document.recipients).selectinload(DocumentRecipient.target_user),
        selectinload(Document.recipients).selectinload(DocumentRecipient.target_org),
        selectinload(Document.creator),
    )


def _delegation_query_with_relations():
    return select(DocumentApprovalDelegation).options(
        selectinload(DocumentApprovalDelegation.principal_user),
        selectinload(DocumentApprovalDelegation.delegate_user),
        selectinload(DocumentApprovalDelegation.org),
    )


async def _has_active_org_membership(
    session: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    at: datetime | None = None,
) -> bool:
    from api.models.org import Position, UserPosition

    day = (at or datetime.now(UTC)).date()
    result = await session.execute(
        select(UserPosition.id)
        .join(Position, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            Position.org_id == org_id,
            *active_tenure_filter(day),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _resolve_active_delegate_assignment(
    session: AsyncSession,
    *,
    principal_user_id: uuid.UUID,
    org_id: uuid.UUID,
    at: datetime | None = None,
) -> DocumentApprovalDelegation | None:
    current = at or datetime.now(UTC)
    result = await session.execute(
        _delegation_query_with_relations()
        .where(
            DocumentApprovalDelegation.principal_user_id == principal_user_id,
            DocumentApprovalDelegation.org_id == org_id,
            DocumentApprovalDelegation.is_active.is_(True),
            DocumentApprovalDelegation.start_at <= current,
            or_(
                DocumentApprovalDelegation.end_at.is_(None),
                DocumentApprovalDelegation.end_at >= current,
            ),
        )
        .order_by(
            DocumentApprovalDelegation.start_at.desc(),
            DocumentApprovalDelegation.created_at.desc(),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _apply_assignment_delegate_to_approval(
    session: AsyncSession,
    approval: DocumentApproval,
    *,
    org_id: uuid.UUID,
    at: datetime | None = None,
) -> None:
    assignment = await _resolve_active_delegate_assignment(
        session,
        principal_user_id=approval.approver_id,
        org_id=org_id,
        at=at,
    )
    if assignment is None:
        if approval.delegate_source == DelegateSource.ASSIGNMENT:
            approval.delegate_id = None
            approval.delegate_source = None
        return
    approval.delegate_id = assignment.delegate_user_id
    approval.delegate_source = DelegateSource.ASSIGNMENT


async def _sync_pending_approval_delegations(
    session: AsyncSession,
    *,
    principal_user_id: uuid.UUID,
    org_id: uuid.UUID,
) -> None:
    result = await session.execute(
        select(DocumentApproval)
        .join(Document, DocumentApproval.document_id == Document.id)
        .where(
            DocumentApproval.approver_id == principal_user_id,
            Document.status == DocumentStatus.PENDING,
            Document.org_id == org_id,
            DocumentApproval.status.in_([ApprovalStepStatus.PENDING, ApprovalStepStatus.WAITING]),
            or_(
                DocumentApproval.delegate_source.is_(None),
                DocumentApproval.delegate_source == DelegateSource.ASSIGNMENT,
            ),
        )
    )
    approvals = list(result.scalars().all())
    if not approvals:
        return

    # 所有 approval 的 principal 相同，只需一次查詢取得當前有效代理人
    assignment = await _resolve_active_delegate_assignment(
        session,
        principal_user_id=principal_user_id,
        org_id=org_id,
    )
    for approval in approvals:
        if assignment is None:
            if approval.delegate_source == DelegateSource.ASSIGNMENT:
                approval.delegate_id = None
                approval.delegate_source = None
        else:
            approval.delegate_id = assignment.delegate_user_id
            approval.delegate_source = DelegateSource.ASSIGNMENT


async def get_document(session: AsyncSession, doc_id: uuid.UUID) -> Document | None:
    result = await session.execute(_doc_query_with_relations().where(Document.id == doc_id))
    return result.scalar_one_or_none()


async def get_document_by_serial(session: AsyncSession, serial_number: str) -> Document | None:
    result = await session.execute(
        _doc_query_with_relations().where(Document.serial_number == serial_number)
    )
    return result.scalar_one_or_none()


async def get_approval_delegation(
    session: AsyncSession,
    delegation_id: uuid.UUID,
) -> DocumentApprovalDelegation | None:
    result = await session.execute(
        _delegation_query_with_relations().where(DocumentApprovalDelegation.id == delegation_id)
    )
    return result.scalar_one_or_none()


def is_sensitive_document(doc: Document) -> bool:
    return doc.classification in SENSITIVE_DOCUMENT_CLASSIFICATIONS


def can_anonymous_access_document(doc: Document) -> bool:
    return doc.visibility_level == DocumentVisibility.PUBLICLY_OPEN and not is_sensitive_document(
        doc
    )


async def user_has_full_document_access(
    session: AsyncSession,
    doc: Document,
    user_id: uuid.UUID,
) -> bool:
    from api.models.org import Position, UserPosition

    if doc.created_by == user_id:
        return True

    approver_ids = {a.approver_id for a in doc.approvals}
    delegate_ids = {a.delegate_id for a in doc.approvals if a.delegate_id}
    if user_id in approver_ids:
        return True
    if user_id in delegate_ids:
        for approval in doc.approvals:
            if approval.delegate_id != user_id:
                continue
            if approval.delegate_source != DelegateSource.ASSIGNMENT:
                return True
            assignment = await _resolve_active_delegate_assignment(
                session,
                principal_user_id=approval.approver_id,
                org_id=doc.org_id,
            )
            if assignment and assignment.delegate_user_id == user_id:
                return True

    viewer = await session.scalar(select(User).where(User.id == user_id))
    if viewer and viewer.email:
        recipient_result = await session.execute(
            select(DocumentRecipient.id).where(
                DocumentRecipient.document_id == doc.id,
                DocumentRecipient.email.is_not(None),
                DocumentRecipient.email == viewer.email,
            )
        )
        if recipient_result.scalar_one_or_none() is not None:
            return True

    today = local_today()
    result = await session.execute(
        select(UserPosition.id)
        .join(Position, UserPosition.position_id == Position.id)
        .where(
            Position.org_id == doc.org_id,
            UserPosition.user_id == user_id,
            *active_tenure_filter(today),
        )
    )
    return result.scalar_one_or_none() is not None


async def check_document_access(
    session: AsyncSession,
    doc: Document,
    user_id: uuid.UUID,
) -> bool:
    if await user_has_full_document_access(session, doc, user_id):
        return True
    return doc.visibility_level in {
        DocumentVisibility.PUBLIC,
        DocumentVisibility.PUBLICLY_OPEN,
    } and not is_sensitive_document(doc)


async def _build_visibility_filter(
    session: AsyncSession,
    viewer_id: uuid.UUID | None = None,
) -> list | None:
    if viewer_id is None:
        return None

    from api.models.org import Position, UserPosition

    viewer = await session.scalar(select(User).where(User.id == viewer_id))
    viewer_email = viewer.email if viewer else None

    org_ids_result = await session.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == viewer_id,
            *active_tenure_filter(local_today()),
        )
        .distinct()
    )
    viewer_org_ids = list(org_ids_result.scalars().all())

    is_approver = exists(
        select(1).where(
            DocumentApproval.document_id == Document.id,
            or_(
                DocumentApproval.approver_id == viewer_id,
                and_(
                    DocumentApproval.delegate_source == DelegateSource.MANUAL,
                    DocumentApproval.delegate_id == viewer_id,
                ),
                and_(
                    DocumentApproval.delegate_source == DelegateSource.ASSIGNMENT,
                    _active_assignment_exists_for_viewer(viewer_id=viewer_id),
                ),
            ),
        )
    )
    is_subject_recipient = (
        exists(
            select(1).where(
                DocumentRecipient.document_id == Document.id,
                DocumentRecipient.email.is_not(None),
                DocumentRecipient.email == viewer_email,
            )
        )
        if viewer_email
        else False
    )

    return [
        Document.visibility_level == DocumentVisibility.PUBLICLY_OPEN,
        Document.visibility_level == DocumentVisibility.PUBLIC,
        Document.created_by == viewer_id,
        is_approver,
        and_(
            Document.visibility_level == DocumentVisibility.ORG_ONLY,
            Document.org_id.in_(viewer_org_ids) if viewer_org_ids else False,
        ),
        and_(
            Document.visibility_level == DocumentVisibility.SUBJECT_ONLY,
            or_(
                Document.created_by == viewer_id,
                is_approver,
                is_subject_recipient,
            ),
        ),
    ]


async def build_document_list_items(
    session: AsyncSession,
    docs: list[Document],
    *,
    viewer_id: uuid.UUID | None,
    reveal_sensitive: bool = False,
) -> list[DocumentListItem]:
    items: list[DocumentListItem] = []
    for doc in docs:
        item = DocumentListItem.model_validate(doc)
        if is_sensitive_document(doc) and not reveal_sensitive:
            has_full_access = viewer_id is not None and await user_has_full_document_access(
                session, doc, viewer_id
            )
            if not has_full_access:
                item = item.model_copy(
                    update={
                        "serial_number": REDACTED_CONFIDENTIAL_TEXT,
                        "title": REDACTED_CONFIDENTIAL_TEXT,
                        "subject": None,
                        "is_redacted": True,
                    }
                )
        items.append(item)
    return items


async def list_documents(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
    status: DocumentStatus | None = None,
    category=None,
    classification: DocumentClassification | None = None,
    visibility: DocumentVisibility | None = None,
    created_by: uuid.UUID | None = None,
    serial_prefix: str | None = None,
    keyword: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    issued_from: date | None = None,
    issued_to: date | None = None,
    handler_keyword: str | None = None,
    recipient_keyword: str | None = None,
    roc_year: int | None = None,
    limit: int = 20,
    offset: int = 0,
    public_only: bool = False,
    viewer_id: uuid.UUID | None = None,
) -> list[Document]:
    q = _doc_query_for_list()
    if public_only:
        q = q.where(Document.visibility_level == DocumentVisibility.PUBLICLY_OPEN)
    elif viewer_id is not None:
        visibility_conditions = await _build_visibility_filter(session, viewer_id)
        if visibility_conditions:
            q = q.where(or_(*visibility_conditions))
    if org_id:
        q = q.where(Document.org_id == org_id)
    if activity_id:
        q = q.where(Document.activity_id == activity_id)
    if status:
        q = q.where(Document.status == status)
    if category:
        q = q.where(Document.category == category)
    if classification:
        q = q.where(Document.classification == classification)
    if visibility:
        q = q.where(Document.visibility_level == visibility)
    if created_by:
        q = q.where(Document.created_by == created_by)
    if serial_prefix:
        q = q.where(Document.serial_number.ilike(f"{serial_prefix}%"))
    if date_from:
        q = q.where(Document.created_at >= datetime.combine(date_from, time.min, tzinfo=UTC))
    if date_to:
        q = q.where(Document.created_at <= datetime.combine(date_to, time.max, tzinfo=UTC))
    if issued_from:
        q = q.where(Document.issued_at >= datetime.combine(issued_from, time.min, tzinfo=UTC))
    if issued_to:
        q = q.where(Document.issued_at <= datetime.combine(issued_to, time.max, tzinfo=UTC))
    if roc_year is not None:
        q = q.where((func.extract("year", Document.issued_at) - 1911) == roc_year)
    if handler_keyword:
        pattern = like_contains(handler_keyword)
        q = q.where(
            or_(
                Document.handler_name.ilike(pattern),
                Document.handler_unit.ilike(pattern),
                Document.handler_email.ilike(pattern),
            )
        )
    if recipient_keyword:
        pattern = like_contains(recipient_keyword)
        q = q.join(DocumentRecipient, DocumentRecipient.document_id == Document.id).where(
            DocumentRecipient.name.ilike(pattern)
        )
        # 注意：不可用 .distinct(Document.id)（PostgreSQL DISTINCT ON 要求其欄位須為
        # ORDER BY 的前綴，而下方一律以 created_at 排序，兩者不符會直接 500）；
        # 這裡改用一般 SELECT DISTINCT，因為 select() 只選 Document 欄位，
        # id 已是主鍵，效果等價於「每份公文只出現一次」。
        q = q.distinct()
    if keyword:
        pattern = like_contains(keyword)
        q = q.where(
            or_(
                Document.serial_number.ilike(pattern),
                Document.title.ilike(pattern),
                Document.subject.ilike(pattern),
                Document.doc_description.ilike(pattern),
                Document.content.ilike(pattern),
            )
        )
    q = q.order_by(Document.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())
