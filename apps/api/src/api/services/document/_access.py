"""公文可見性 / 存取控制 / 查詢輔助"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, date, datetime, time

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, load_only, selectinload
from sqlalchemy.orm.attributes import set_committed_value

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
    {
        DocumentClassification.CONFIDENTIAL,
        DocumentClassification.SECRET,
        DocumentClassification.HIGHLY_CONFIDENTIAL,
        DocumentClassification.ABSOLUTELY_CONFIDENTIAL,
    }
)


def encode_document_cursor(document: Document) -> str:
    """以 created_at + UUID 建立不受 offset 漂移影響的 opaque cursor。"""
    raw = f"{document.created_at.isoformat()}|{document.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_document_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        created_at, document_id = base64.urlsafe_b64decode(padded).decode().split("|", 1)
        return datetime.fromisoformat(created_at), uuid.UUID(document_id)
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise ValueError("無效的公文 cursor") from exc


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
    """列表直接載入完整公文欄位，避免欄位精簡造成前後端資料不同步。"""
    return select(Document)


def _doc_query_with_relations():
    return select(Document).options(
        selectinload(Document.org),
        selectinload(Document.revisions),
        selectinload(Document.approvals).selectinload(DocumentApproval.approver),
        selectinload(Document.approvals).selectinload(DocumentApproval.delegate),
        selectinload(Document.attachments),
        selectinload(Document.recipients).selectinload(DocumentRecipient.target_user),
        selectinload(Document.recipients).selectinload(DocumentRecipient.target_org),
        selectinload(Document.recipients).selectinload(DocumentRecipient.target_class),
        selectinload(Document.creator),
    )


def _doc_query_for_detail():
    """公文詳情專用查詢，只載入 DocumentOut 與存取檢查真正需要的關聯。"""
    return select(Document).options(
        selectinload(Document.revisions),
        selectinload(Document.approvals).joinedload(DocumentApproval.approver),
        selectinload(Document.approvals).joinedload(DocumentApproval.delegate),
        selectinload(Document.attachments),
        selectinload(Document.recipients),
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


async def _get_active_descendant_org_ids(
    session: AsyncSession,
    org_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    """取得指定機關的所有下屬機關，供密件的上層機關存取判斷使用。"""
    if not org_ids:
        return set()

    from api.models.org import Org

    org_tree = (
        select(Org.id)
        .where(Org.id.in_(org_ids), Org.is_active.is_(True))
        .cte("viewer_org_tree", recursive=True)
    )
    child_org = aliased(Org)
    org_tree = org_tree.union_all(
        select(child_org.id).where(
            child_org.parent_id == org_tree.c.id,
            child_org.is_active.is_(True),
        )
    )
    result = await session.execute(
        select(org_tree.c.id).where(~org_tree.c.id.in_(org_ids)).distinct()
    )
    return set(result.scalars().all())


async def _has_active_class_membership(
    session: AsyncSession,
    user_id: uuid.UUID,
    class_id: uuid.UUID,
) -> bool:
    from api.models.school_class import SchoolClass
    from api.services.school_class import is_class_member

    user = await session.get(User, user_id)
    school_class = await session.scalar(
        select(SchoolClass)
        .where(SchoolClass.id == class_id)
        .options(
            selectinload(SchoolClass.ranges),
            selectinload(SchoolClass.roster_entries),
            selectinload(SchoolClass.manual_members),
        )
    )
    if user is None or school_class is None or not school_class.is_active:
        return False
    return await is_class_member(session, school_class, user)


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


async def get_document_detail(session: AsyncSession, doc_id: uuid.UUID) -> Document | None:
    result = await session.execute(_doc_query_for_detail().where(Document.id == doc_id))
    return result.scalar_one_or_none()


async def get_document_by_serial(session: AsyncSession, serial_number: str) -> Document | None:
    result = await session.execute(
        _doc_query_with_relations().where(Document.serial_number == serial_number)
    )
    document = result.scalar_one_or_none()
    if document is not None:
        return document

    # 公文字號中的空格只是排版差異，連結可能在複製或手動輸入時被省略。
    normalized_serial = serial_number.replace(" ", "")
    result = await session.execute(
        _doc_query_with_relations().where(
            func.replace(Document.serial_number, " ", "") == normalized_serial
        )
    )
    return result.scalar_one_or_none()


async def get_document_detail_by_serial(
    session: AsyncSession, serial_number: str
) -> Document | None:
    query = _doc_query_for_detail().where(Document.serial_number == serial_number)
    document = (await session.execute(query)).scalar_one_or_none()
    if document is not None:
        return document

    # 公文字號中的空格只是排版差異，連結可能在複製或手動輸入時被省略。
    normalized_serial = serial_number.replace(" ", "")
    query = _doc_query_for_detail().where(
        func.replace(Document.serial_number, " ", "") == normalized_serial
    )
    return (await session.execute(query)).scalar_one_or_none()


async def get_document_detail_by_identifier(
    session: AsyncSession, identifier: uuid.UUID | str
) -> Document | None:
    """以 UUID 或字號取得公文詳情，使用最小關聯集合。"""
    if isinstance(identifier, uuid.UUID):
        return await get_document_detail(session, identifier)
    try:
        return await get_document_detail(session, uuid.UUID(identifier))
    except ValueError:
        return await get_document_detail_by_serial(session, identifier)


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
    return (
        doc.visibility_level == DocumentVisibility.PUBLICLY_OPEN
        or doc.is_public is True  # 舊版 API 只寫入 is_public 的資料
    ) and not is_sensitive_document(doc)


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

    target_result = await session.execute(
        select(
            DocumentRecipient.target_user_id,
            DocumentRecipient.target_org_id,
            DocumentRecipient.target_class_id,
        ).where(DocumentRecipient.document_id == doc.id)
    )
    for target_user_id, target_org_id, target_class_id in target_result:
        if target_user_id == user_id:
            return True
        if target_org_id is not None and await _has_active_org_membership(
            session, user_id, target_org_id
        ):
            return True
        if target_class_id is not None and await _has_active_class_membership(
            session, user_id, target_class_id
        ):
            return True

    today = local_today()
    result = await session.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == user_id, *active_tenure_filter(today))
    )
    viewer_org_ids = list(result.scalars().all())
    if doc.visibility_level == DocumentVisibility.SUBJECT_ONLY:
        descendant_org_ids = await _get_active_descendant_org_ids(session, viewer_org_ids)
        return doc.org_id in descendant_org_ids
    return doc.org_id in viewer_org_ids


async def check_document_access(
    session: AsyncSession,
    doc: Document,
    user_id: uuid.UUID,
) -> bool:
    if await user_has_full_document_access(session, doc, user_id):
        return True
    # 公開狀態同時支援新欄位與舊版 is_public 旗標；兩者必須共用同一套
    # 判定，避免未登入列表能看到、登入後詳情卻被 403 的身份切換問題。
    return can_anonymous_access_document(doc)


async def _build_visibility_filter(
    session: AsyncSession,
    viewer_id: uuid.UUID | None = None,
) -> list | None:
    if viewer_id is None:
        return None

    from api.models.org import Position, UserPosition
    from api.services.school_class import get_user_active_class_ids

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
    subject_org_ids = await _get_active_descendant_org_ids(session, viewer_org_ids)
    viewer_class_ids = await get_user_active_class_ids(session, viewer_id)

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
    recipient_conditions = [DocumentRecipient.target_user_id == viewer_id]
    if viewer_email:
        recipient_conditions.append(
            and_(
                DocumentRecipient.email.is_not(None),
                DocumentRecipient.email == viewer_email,
            )
        )
    if viewer_org_ids:
        recipient_conditions.append(DocumentRecipient.target_org_id.in_(viewer_org_ids))
    if viewer_class_ids:
        recipient_conditions.append(DocumentRecipient.target_class_id.in_(viewer_class_ids))
    is_subject_recipient = exists(
        select(1).where(
            DocumentRecipient.document_id == Document.id,
            or_(*recipient_conditions),
        )
    )

    return [
        Document.visibility_level == DocumentVisibility.PUBLICLY_OPEN,
        Document.is_public.is_(True),
        Document.visibility_level == DocumentVisibility.PUBLIC,
        Document.created_by == viewer_id,
        is_approver,
        is_subject_recipient,
        and_(
            Document.visibility_level == DocumentVisibility.ORG_ONLY,
            Document.org_id.in_(viewer_org_ids) if viewer_org_ids else False,
        ),
        and_(
            Document.visibility_level == DocumentVisibility.SUBJECT_ONLY,
            Document.org_id.in_(subject_org_ids) if subject_org_ids else False,
        ),
    ]


async def build_document_list_items(
    session: AsyncSession,
    docs: list[Document],
    *,
    viewer_id: uuid.UUID | None,
    reveal_sensitive: bool = False,
) -> list[DocumentListItem]:
    access_docs: dict[uuid.UUID, Document] = {}
    if viewer_id is not None:
        sensitive_ids = [doc.id for doc in docs if is_sensitive_document(doc)]
        if sensitive_ids:
            approval_result = await session.execute(
                select(DocumentApproval)
                .options(
                    load_only(
                        DocumentApproval.id,
                        DocumentApproval.document_id,
                        DocumentApproval.approver_id,
                        DocumentApproval.delegate_id,
                        DocumentApproval.delegate_source,
                    )
                )
                .where(DocumentApproval.document_id.in_(sensitive_ids))
            )
            recipient_result = await session.execute(
                select(DocumentRecipient)
                .options(
                    load_only(
                        DocumentRecipient.id,
                        DocumentRecipient.document_id,
                        DocumentRecipient.email,
                        DocumentRecipient.target_user_id,
                        DocumentRecipient.target_org_id,
                        DocumentRecipient.target_class_id,
                    )
                )
                .where(DocumentRecipient.document_id.in_(sensitive_ids))
            )
            approvals_by_doc: dict[uuid.UUID, list[DocumentApproval]] = {}
            for approval in approval_result.scalars().all():
                approvals_by_doc.setdefault(approval.document_id, []).append(approval)
            recipients_by_doc: dict[uuid.UUID, list[DocumentRecipient]] = {}
            for recipient in recipient_result.scalars().all():
                recipients_by_doc.setdefault(recipient.document_id, []).append(recipient)
            for doc in docs:
                if doc.id not in sensitive_ids:
                    continue
                set_committed_value(doc, "approvals", approvals_by_doc.get(doc.id, []))
                set_committed_value(doc, "recipients", recipients_by_doc.get(doc.id, []))
                access_docs[doc.id] = doc

    items: list[DocumentListItem] = []
    for doc in docs:
        item = DocumentListItem.model_validate(doc)
        if is_sensitive_document(doc) and not reveal_sensitive:
            has_full_access = viewer_id is not None and await user_has_full_document_access(
                session, access_docs.get(doc.id, doc), viewer_id
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
    cursor: str | None = None,
    public_only: bool = False,
    viewer_id: uuid.UUID | None = None,
) -> list[Document]:
    q = _doc_query_for_list()
    if public_only:
        q = q.where(
            or_(
                Document.visibility_level == DocumentVisibility.PUBLICLY_OPEN,
                Document.is_public.is_(True),
            )
        )
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
        if visibility == DocumentVisibility.PUBLICLY_OPEN:
            q = q.where(
                or_(
                    Document.visibility_level == DocumentVisibility.PUBLICLY_OPEN,
                    Document.is_public.is_(True),
                )
            )
        else:
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
    if cursor:
        cursor_created_at, cursor_id = decode_document_cursor(cursor)
        q = q.where(
            or_(
                Document.created_at < cursor_created_at,
                and_(Document.created_at == cursor_created_at, Document.id < cursor_id),
            )
        )
        offset = 0
    q = q.order_by(Document.created_at.desc(), Document.id.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())
