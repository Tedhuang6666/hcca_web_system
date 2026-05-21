"""公文服務層 - CRUD、狀態機（含退回至上一關）、字號生成、組織可見性"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime, time

from sqlalchemy import and_, exists, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
    DocumentCategory,
    DocumentClassification,
    DocumentRecipient,
    DocumentRevision,
    DocumentSerialTemplate,
    DocumentStatus,
    DocumentTemplate,
    DocumentVisibility,
    YearMode,
)
from api.models.org import Org
from api.models.user import User
from api.schemas.document import (
    DocumentApprovalDelegationCreate,
    DocumentApprovalDelegationUpdate,
    DocumentCreate,
    DocumentListItem,
    DocumentTemplateCreate,
    DocumentTemplateDraftCreate,
    DocumentTemplateUpdate,
    DocumentUpdate,
    RecipientCreate,
    SerialTemplateCreate,
)
from api.services.permission import active_tenure_filter

logger = logging.getLogger(__name__)

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


# ── 字號自動生成 ───────────────────────────────────────────────────────────────


async def generate_serial_number(session: AsyncSession) -> str:
    """
    使用 PostgreSQL Sequence 原子性取得序號，格式：DOC-YYYY-NNNNNN
    此為向下相容的舊格式，新公文應使用 generate_serial_from_template。
    """
    result = await session.execute(text("SELECT nextval('document_serial_seq')"))
    seq_val: int = result.scalar_one()
    year = datetime.now(UTC).year
    return f"DOC-{year}-{seq_val:06d}"


async def generate_serial_from_template(
    session: AsyncSession,
    template: DocumentSerialTemplate,
) -> str:
    """
    以組織字號模板原子性生成字號。
    格式：{org_prefix}{category_char}字第 {year}{counter:07d} 號
    範例：嶺代生字第 1150000001 號

    使用 SELECT ... FOR UPDATE 確保高並發安全。
    若跨年且 reset_on_new_year=True，自動重置流水號。
    """
    now = datetime.now(UTC)
    # 計算當前年份（ROC = CE - 1911）
    current_year = now.year - 1911 if template.year_mode == YearMode.ROC else now.year

    # 原子性取得並更新 counter（SELECT FOR UPDATE 鎖定列）
    result = await session.execute(
        select(DocumentSerialTemplate)
        .where(DocumentSerialTemplate.id == template.id)
        .with_for_update()
    )
    locked_template = result.scalar_one()

    # 跨年重置
    if locked_template.reset_on_new_year and locked_template.current_year != current_year:
        locked_template.current_year = current_year
        locked_template.counter = 1
    else:
        locked_template.counter += 1

    counter_val = locked_template.counter
    await session.flush()

    # 格式：嶺代生字第 1150000001 號（年份3碼+流水號7碼 = 10碼）
    return (
        f"{locked_template.org_prefix}{locked_template.category_char}"
        f"字第 {current_year}{counter_val:07d} 號"
    )


# ── 字號模板 CRUD ──────────────────────────────────────────────────────────────


async def create_serial_template(
    session: AsyncSession,
    *,
    data: SerialTemplateCreate,
    created_by: uuid.UUID,
) -> DocumentSerialTemplate:
    """
    建立字號模板（需有 serial:create 權限）。
    org_prefix 自動從組織的 Org.prefix 欄位取得。
    重複的 org_id + org_prefix + category_char 組合會觸發 UniqueConstraint 錯誤。
    """
    # 取得組織 prefix（只查詢必要欄位）
    org_result = await session.execute(select(Org.prefix, Org.name).where(Org.id == data.org_id))
    org_row = org_result.first()
    if org_row is None:
        raise ValueError("指定的組織不存在")
    prefix, org_name = org_row
    if not prefix:
        raise ValueError(f"組織「{org_name}」尚未設定字號前綴（Org.prefix），請先由管理員設定")

    now = datetime.now(UTC)
    current_year = now.year - 1911 if data.year_mode == YearMode.ROC else now.year

    template = DocumentSerialTemplate(
        org_id=data.org_id,
        org_prefix=prefix,
        category_char=data.category_char,
        year_mode=data.year_mode,
        reset_on_new_year=data.reset_on_new_year,
        current_year=current_year,
        counter=0,
        is_active=True,
        is_default=data.is_default,
        is_default_president_publish=data.is_default_president_publish,
        description=data.description,
        created_by=created_by,
    )
    session.add(template)
    await session.flush()
    if template.is_default:
        result = await session.execute(
            select(DocumentSerialTemplate).where(
                DocumentSerialTemplate.org_id == template.org_id,
                DocumentSerialTemplate.id != template.id,
            )
        )
        siblings = list(result.scalars().all())
        for sibling in siblings:
            if sibling.is_default:
                sibling.is_default = False
        await session.flush()
    if template.is_default_president_publish:
        result = await session.execute(
            select(DocumentSerialTemplate).where(DocumentSerialTemplate.id != template.id)
        )
        siblings = list(result.scalars().all())
        for sibling in siblings:
            if sibling.is_default_president_publish:
                sibling.is_default_president_publish = False
        await session.flush()
    logger.info(
        "字號模板建立 id=%s org_id=%s prefix=%s%s",
        template.id,
        data.org_id,
        prefix,
        data.category_char,
    )
    return template


async def get_serial_template(
    session: AsyncSession,
    template_id: uuid.UUID,
) -> DocumentSerialTemplate | None:
    result = await session.execute(
        select(DocumentSerialTemplate).where(DocumentSerialTemplate.id == template_id)
    )
    return result.scalar_one_or_none()


async def list_serial_templates(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    active_only: bool = True,
) -> list[DocumentSerialTemplate]:
    """列出字號模板（預設僅顯示有效模板）"""
    q = select(DocumentSerialTemplate)
    if org_id:
        q = q.where(DocumentSerialTemplate.org_id == org_id)
    if active_only:
        q = q.where(DocumentSerialTemplate.is_active.is_(True))
    q = q.order_by(
        DocumentSerialTemplate.is_default_president_publish.desc(),
        DocumentSerialTemplate.is_default.desc(),
        DocumentSerialTemplate.org_prefix,
        DocumentSerialTemplate.category_char,
    )
    result = await session.execute(q)
    return list(result.scalars().all())


async def deactivate_serial_template(
    session: AsyncSession,
    template: DocumentSerialTemplate,
) -> DocumentSerialTemplate:
    """停用字號模板（is_active=False）"""
    template.is_active = False
    template.is_default = False
    template.is_default_president_publish = False
    await session.flush()
    return template


async def update_serial_template(
    session: AsyncSession,
    template: DocumentSerialTemplate,
    *,
    updates: dict,
) -> DocumentSerialTemplate:
    for field, value in updates.items():
        setattr(template, field, value)
    if not template.is_active:
        template.is_default = False
        template.is_default_president_publish = False
    await session.flush()
    if template.is_default:
        result = await session.execute(
            select(DocumentSerialTemplate).where(
                DocumentSerialTemplate.org_id == template.org_id,
                DocumentSerialTemplate.id != template.id,
            )
        )
        siblings = list(result.scalars().all())
        for sibling in siblings:
            if sibling.is_default:
                sibling.is_default = False
        await session.flush()
    if template.is_default_president_publish:
        result = await session.execute(
            select(DocumentSerialTemplate).where(DocumentSerialTemplate.id != template.id)
        )
        siblings = list(result.scalars().all())
        for sibling in siblings:
            if sibling.is_default_president_publish:
                sibling.is_default_president_publish = False
        await session.flush()
    return template


# ── 公文內容範本 CRUD ──────────────────────────────────────────────────────────


def _recipients_to_json(recipients: list[RecipientCreate]) -> list[dict[str, str | None]]:
    return [item.model_dump(mode="json") for item in recipients]


def _recipients_from_json(items: list[dict] | None) -> list[RecipientCreate]:
    return [RecipientCreate.model_validate(item) for item in (items or [])]


def _validate_document_template(template: DocumentTemplate) -> None:
    DocumentTemplateCreate(
        org_id=template.org_id,
        name=template.name,
        description=template.description,
        issuer_full_name=template.issuer_full_name,
        urgency=template.urgency,
        classification=template.classification,
        declassification_condition=template.declassification_condition,
        category=template.category,
        subject=template.subject,
        doc_description=template.doc_description,
        action_required=template.action_required,
        content=template.content,
        meeting_purpose=template.meeting_purpose,
        meeting_location=template.meeting_location,
        meeting_chairperson=template.meeting_chairperson,
        handler_unit=template.handler_unit,
        file_number=template.file_number,
        retention_period=template.retention_period,
        visibility_level=template.visibility_level,
        recipients=_recipients_from_json(template.recipients),
    )


async def create_document_template(
    session: AsyncSession,
    *,
    data: DocumentTemplateCreate,
    created_by: uuid.UUID,
) -> DocumentTemplate:
    template = DocumentTemplate(
        org_id=data.org_id,
        name=data.name,
        description=data.description,
        issuer_full_name=data.issuer_full_name,
        urgency=data.urgency,
        classification=data.classification,
        declassification_condition=data.declassification_condition,
        category=data.category,
        subject=data.subject,
        doc_description=data.doc_description,
        action_required=data.action_required,
        content=data.content,
        meeting_purpose=data.meeting_purpose,
        meeting_location=data.meeting_location,
        meeting_chairperson=data.meeting_chairperson,
        handler_unit=data.handler_unit,
        file_number=data.file_number,
        retention_period=data.retention_period,
        visibility_level=data.visibility_level,
        recipients=_recipients_to_json(data.recipients),
        created_by=created_by,
        updated_by=created_by,
    )
    session.add(template)
    await session.flush()
    return template


async def get_document_template(
    session: AsyncSession,
    template_id: uuid.UUID,
) -> DocumentTemplate | None:
    result = await session.execute(
        select(DocumentTemplate).where(DocumentTemplate.id == template_id)
    )
    return result.scalar_one_or_none()


async def list_document_templates(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    org_ids: list[uuid.UUID] | None = None,
    category: DocumentCategory | None = None,
    active_only: bool = True,
    keyword: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[DocumentTemplate]:
    q = select(DocumentTemplate)
    if org_id:
        q = q.where(DocumentTemplate.org_id == org_id)
    elif org_ids is not None:
        if not org_ids:
            return []
        q = q.where(DocumentTemplate.org_id.in_(org_ids))
    if category:
        q = q.where(DocumentTemplate.category == category)
    if active_only:
        q = q.where(DocumentTemplate.is_active.is_(True))
    if keyword:
        pattern = f"%{keyword}%"
        q = q.where(
            or_(
                DocumentTemplate.name.ilike(pattern),
                DocumentTemplate.description.ilike(pattern),
                DocumentTemplate.subject.ilike(pattern),
                DocumentTemplate.doc_description.ilike(pattern),
            )
        )
    q = q.order_by(DocumentTemplate.updated_at.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def update_document_template(
    session: AsyncSession,
    template: DocumentTemplate,
    *,
    data: DocumentTemplateUpdate,
    updated_by: uuid.UUID,
) -> DocumentTemplate:
    recipients = data.recipients if "recipients" in data.model_fields_set else None
    updates = data.model_dump(exclude_unset=True, exclude={"recipients"})
    for field, value in updates.items():
        setattr(template, field, value)
    if recipients is not None:
        template.recipients = _recipients_to_json(recipients)
    _validate_document_template(template)
    template.updated_by = updated_by
    template.version += 1
    await session.flush()
    return template


async def deactivate_document_template(
    session: AsyncSession,
    template: DocumentTemplate,
    *,
    updated_by: uuid.UUID,
) -> DocumentTemplate:
    template.is_active = False
    template.updated_by = updated_by
    template.version += 1
    await session.flush()
    return template


async def create_document_from_template(
    session: AsyncSession,
    *,
    template: DocumentTemplate,
    data: DocumentTemplateDraftCreate,
    created_by: uuid.UUID,
) -> Document:
    title = data.title or template.name
    payload = DocumentCreate(
        title=title,
        org_id=template.org_id,
        serial_template_id=data.serial_template_id,
        issuer_full_name=template.issuer_full_name,
        urgency=template.urgency,
        classification=template.classification,
        declassification_condition=template.declassification_condition,
        category=template.category,
        subject=template.subject,
        doc_description=template.doc_description,
        action_required=template.action_required,
        content=template.content,
        meeting_purpose=template.meeting_purpose,
        meeting_time=data.meeting_time,
        meeting_location=template.meeting_location,
        meeting_chairperson=template.meeting_chairperson,
        handler_name=data.handler_name,
        handler_unit=template.handler_unit,
        handler_email=data.handler_email,
        file_number=template.file_number,
        retention_period=template.retention_period,
        due_date=data.due_date,
        visibility_level=template.visibility_level,
        recipients=data.recipients or _recipients_from_json(template.recipients),
    )
    return await create_document(session, data=payload, created_by=created_by)


# ── 查詢輔助 ────────────────────────────────────────────────────────────────────


def _doc_query_for_list():
    """列表用查詢：最小化加載（只有基本字段 + 建立者）"""
    return select(Document).options(
        selectinload(Document.creator),
        selectinload(Document.org),
    )


def _doc_query_with_relations():
    """詳細查詢：含所有子關聯（版本、審核步驟、附件、受文者）"""
    return select(Document).options(
        selectinload(Document.org),
        selectinload(Document.revisions),
        selectinload(Document.approvals).selectinload(DocumentApproval.approver),
        selectinload(Document.approvals).selectinload(DocumentApproval.delegate),
        selectinload(Document.attachments),
        selectinload(Document.recipients),
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
            DocumentApprovalDelegation.start_at.desc(), DocumentApprovalDelegation.created_at.desc()
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
    for approval in approvals:
        await _apply_assignment_delegate_to_approval(session, approval, org_id=org_id)


async def get_document(session: AsyncSession, doc_id: uuid.UUID) -> Document | None:
    """以 UUID 取得公文（含所有關聯資料）"""
    result = await session.execute(_doc_query_with_relations().where(Document.id == doc_id))
    return result.scalar_one_or_none()


async def get_document_by_serial(session: AsyncSession, serial_number: str) -> Document | None:
    """以字號取得公文（含所有關聯資料）"""
    result = await session.execute(
        _doc_query_with_relations().where(Document.serial_number == serial_number)
    )
    return result.scalar_one_or_none()


def is_sensitive_document(doc: Document) -> bool:
    """密等非普通者，列表需依完整讀取權限遮蔽內容。"""
    return doc.classification in SENSITIVE_DOCUMENT_CLASSIFICATIONS


def can_anonymous_access_document(doc: Document) -> bool:
    """未登入訪客僅可查看公開且非密件的公文全文。"""
    return doc.visibility_level == DocumentVisibility.PUBLICLY_OPEN and not is_sensitive_document(
        doc
    )


async def user_has_full_document_access(
    session: AsyncSession,
    doc: Document,
    user_id: uuid.UUID,
) -> bool:
    """
    檢查使用者是否可查看完整公文內容。
    完整權限包含：建立者、審核人/有效代理、受文者、現任同組織成員。
    """
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

    today = date.today()
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
    """
    檢查使用者是否有權限查看此公文。
    有以下任一身份者可查看：
    1. 公文建立者
    2. 任一審核步驟的審核人
    3. 與公文同組織的成員（透過 UserPosition -> Position -> Org 確認）
    """
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
    """建構文件可見性篩選條件。用於 list_documents() 及其他需要可見性檢查的查詢。
    回傳 OR 條件列表；若 viewer_id 為 None 則回傳 None（無篩選）。
    """
    if viewer_id is None:
        return None

    from api.models.document import DocumentApproval, DocumentRecipient
    from api.models.org import Position, UserPosition

    viewer = await session.scalar(select(User).where(User.id == viewer_id))
    viewer_email = viewer.email if viewer else None

    org_ids_result = await session.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == viewer_id,
            *active_tenure_filter(date.today()),
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
    """將公文 ORM 轉為列表項目，並遮蔽無完整權限者看到的密件內容。"""
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
    status: DocumentStatus | None = None,
    category: DocumentCategory | None = None,
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
    """列表查詢：支援組織、狀態、類別、密等、日期、建立者與關鍵字搜尋。
    public_only=True 時僅回傳 publicly_open 的公文（未登入訪客）。
    viewer_id 有值時額外顯示對該使用者公開的公文。
    """
    q = _doc_query_for_list()
    if public_only:
        q = q.where(Document.visibility_level == DocumentVisibility.PUBLICLY_OPEN)
    elif viewer_id is not None:
        visibility_conditions = await _build_visibility_filter(session, viewer_id)
        if visibility_conditions:
            q = q.where(or_(*visibility_conditions))
    if org_id:
        q = q.where(Document.org_id == org_id)
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
        # issued_at 為主；未發文的公文不納入此條件
        q = q.where((func.extract("year", Document.issued_at) - 1911) == roc_year)
    if handler_keyword:
        pattern = f"%{handler_keyword}%"
        q = q.where(
            or_(
                Document.handler_name.ilike(pattern),
                Document.handler_unit.ilike(pattern),
                Document.handler_email.ilike(pattern),
            )
        )
    if recipient_keyword:
        from api.models.document import DocumentRecipient

        pattern = f"%{recipient_keyword}%"
        q = q.join(DocumentRecipient, DocumentRecipient.document_id == Document.id).where(
            DocumentRecipient.name.ilike(pattern)
        )
        q = q.distinct(Document.id)
    if keyword:
        pattern = f"%{keyword}%"
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


# ── 建立公文 ────────────────────────────────────────────────────────────────────


async def create_document(
    session: AsyncSession,
    *,
    data: DocumentCreate,
    created_by: uuid.UUID,
) -> Document:
    """
    建立草稿公文。
    - 若 data.serial_template_id 有值，使用組織字號模板生成字號（如：嶺代生字第 1150000001 號）
    - 否則使用通用 PostgreSQL Sequence 格式（DOC-YYYY-NNNNNN）
    - 建立初始版本快照（Rev.1）
    - 若傳入受文者清單，一併建立 DocumentRecipient
    """
    template: DocumentSerialTemplate | None = None
    if data.serial_template_id:
        template = await get_serial_template(session, data.serial_template_id)
        if template is None or not template.is_active:
            msg = "指定的字號模板不存在或已停用"
            raise ValueError(msg)
        if template.org_id != data.org_id:
            msg = "字號模板不屬於此組織，無法使用"
            raise PermissionError(msg)
        serial = await generate_serial_from_template(session, template)
    else:
        serial = await generate_serial_number(session)

    visibility = data.visibility_level
    doc = Document(
        serial_number=serial,
        title=data.title,
        issuer_full_name=data.issuer_full_name,
        org_id=data.org_id,
        created_by=created_by,
        status=DocumentStatus.DRAFT,
        urgency=data.urgency,
        classification=data.classification,
        declassification_condition=data.declassification_condition,
        confidentiality_expires_at=data.confidentiality_expires_at,
        category=data.category,
        subject=data.subject,
        doc_description=data.doc_description,
        action_required=data.action_required,
        content=data.content,
        handler_name=data.handler_name,
        handler_unit=data.handler_unit,
        handler_email=data.handler_email,
        file_number=data.file_number,
        retention_period=data.retention_period,
        due_date=data.due_date,
        page_info=data.page_info,
        serial_template_id=template.id if template else None,
        visibility_level=visibility,
        is_public=(visibility == DocumentVisibility.PUBLICLY_OPEN),
    )
    session.add(doc)
    await session.flush()  # 取得 doc.id

    # 建立初始版本快照 Rev.1
    rev = DocumentRevision(
        document_id=doc.id,
        revision_number=1,
        title=doc.title,
        content=doc.content,
        change_note="初稿建立",
        changed_by=created_by,
    )
    session.add(rev)

    # 建立受文者清單
    for r in data.recipients:
        session.add(
            DocumentRecipient(
                document_id=doc.id,
                recipient_type=r.recipient_type,
                name=r.name,
                email=r.email,
            )
        )

    await session.flush()
    logger.info("公文建立 serial=%s id=%s", serial, doc.id)

    # 重新查詢含所有關聯（revisions, approvals, attachments, recipients, creator）的完整物件，
    # 避免 FastAPI 序列化時觸發 Lazy Loading → MissingGreenlet 錯誤
    loaded = await get_document(session, doc.id)
    assert loaded is not None  # flush 後一定存在
    return loaded


# ── 更新草稿 ────────────────────────────────────────────────────────────────────


async def update_document(
    session: AsyncSession,
    doc: Document,
    *,
    data: DocumentUpdate,
    changed_by: uuid.UUID,
) -> Document:
    """
    更新草稿內容並自動建立新版本快照。
    - 僅 DRAFT 狀態允許
    - 任何欄位有變更即遞增版本號並記錄 Revision
    """
    if doc.status != DocumentStatus.DRAFT:
        msg = f"公文 {doc.serial_number} 非草稿狀態（{doc.status}），無法編輯"
        raise ValueError(msg)

    # 逐欄位更新（exclude_unset 確保只更新使用者實際傳入的欄位）
    changed = False
    update_fields = data.model_dump(exclude_unset=True, exclude={"change_note"})
    for field, value in update_fields.items():
        if getattr(doc, field, None) != value:
            setattr(doc, field, value)
            changed = True
    # 同步 visibility_level → is_public
    if "visibility_level" in update_fields:
        doc.is_public = doc.visibility_level == DocumentVisibility.PUBLICLY_OPEN

    if changed:
        result = await session.execute(
            select(func.max(DocumentRevision.revision_number)).where(
                DocumentRevision.document_id == doc.id
            )
        )
        current_max: int = result.scalar_one() or 0
        session.add(
            DocumentRevision(
                document_id=doc.id,
                revision_number=current_max + 1,
                title=doc.title,
                content=doc.content,
                change_note=data.change_note,
                changed_by=changed_by,
            )
        )

    await session.flush()
    return doc


# ── 狀態機：送審 ───────────────────────────────────────────────────────────────


async def submit_document(
    session: AsyncSession,
    doc: Document,
    *,
    approver_ids: list[uuid.UUID],
) -> Document:
    """
    草稿 → 待審核。
    同時建立審核步驟（step_order=1 設為 PENDING，其餘為 WAITING）。
    """
    if doc.status != DocumentStatus.DRAFT:
        msg = f"公文 {doc.serial_number} 非草稿狀態，無法送審"
        raise ValueError(msg)
    if not approver_ids:
        msg = "送審至少需要一位審核人"
        raise ValueError(msg)

    now = datetime.now(UTC)
    doc.status = DocumentStatus.PENDING
    doc.submitted_at = now
    doc.current_step = 1

    for order, approver_id in enumerate(approver_ids, start=1):
        step_status = ApprovalStepStatus.PENDING if order == 1 else ApprovalStepStatus.WAITING
        approval = DocumentApproval(
            document_id=doc.id,
            approver_id=approver_id,
            step_order=order,
            status=step_status,
        )
        await _apply_assignment_delegate_to_approval(session, approval, org_id=doc.org_id)
        session.add(approval)

    await session.flush()
    logger.info("公文送審 serial=%s approvers=%d", doc.serial_number, len(approver_ids))
    return doc


# ── 狀態機：直接發文（跳過審核）──────────────────────────────────────────────────


async def issue_document_directly(
    session: AsyncSession,
    doc: Document,
    *,
    issued_by: uuid.UUID,
    comment: str | None = None,
) -> Document:
    """
    直接發文：草稿 → 已核准，跳過所有審核步驟。
    需擁有 document:issue_direct 權限。
    """
    if doc.status != DocumentStatus.DRAFT:
        msg = f"公文 {doc.serial_number} 非草稿狀態，無法直接發文"
        raise ValueError(msg)

    now = datetime.now(UTC)
    doc.status = DocumentStatus.APPROVED
    doc.issued_at = now
    doc.submitted_at = now
    doc.completed_at = now

    # 建立一個「直接發文」的 approval 記錄，方便審計追蹤
    approval = DocumentApproval(
        document_id=doc.id,
        approver_id=issued_by,
        step_order=1,
        status=ApprovalStepStatus.APPROVED,
        comment=comment or "直接發文（跳過審核流程）",
        decided_at=now,
    )
    session.add(approval)

    await session.flush()
    logger.info("公文直接發文 serial=%s by=%s", doc.serial_number, issued_by)
    return doc


# ── 狀態機：建議審核人 ─────────────────────────────────────────────────────────


async def suggest_approvers(
    session: AsyncSession,
    org_id: uuid.UUID,
) -> list:
    """
    依發文組織，回傳擁有 document:approve 權限且任期有效的使用者清單。
    供前端在送審面板自動預帶建議審核人。
    """
    from datetime import date

    from api.models.org import Permission, Position, UserPosition
    from api.models.user import User as UserModel

    today = date.today()
    result = await session.execute(
        select(UserModel)
        .join(UserPosition, UserModel.id == UserPosition.user_id)
        .join(Position, UserPosition.position_id == Position.id)
        .join(Permission, Position.id == Permission.position_id)
        .where(
            Position.org_id == org_id,
            Permission.code == "document:approve",
            UserModel.is_active == True,  # noqa: E712
            *active_tenure_filter(today),
        )
        .distinct()
        .order_by(UserModel.display_name)
    )
    return list(result.scalars().all())


# ── 狀態機：核准 ───────────────────────────────────────────────────────────────


async def approve_step(
    session: AsyncSession,
    doc: Document,
    *,
    approver_id: uuid.UUID,
    comment: str | None = None,
) -> Document:
    """
    核准當前步驟。若為最後一關，文件狀態改為 APPROVED；
    否則將下一關卡設為 PENDING。
    """
    if doc.status != DocumentStatus.PENDING:
        msg = f"公文 {doc.serial_number} 非待審核狀態"
        raise ValueError(msg)

    # 找當前步驟（主審核人或其代理人均可操作）
    current_approval, is_acting = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        msg = "找不到對應的審核步驟，或您不是此步驟的審核人（含代理）"
        raise PermissionError(msg)

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.APPROVED
    current_approval.comment = comment
    current_approval.decided_at = now
    current_approval.is_acting = is_acting

    # 尋找下一步
    next_result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == doc.current_step + 1,
        )
    )
    next_approval = next_result.scalar_one_or_none()

    if next_approval:
        await _apply_assignment_delegate_to_approval(session, next_approval, org_id=doc.org_id)
        next_approval.status = ApprovalStepStatus.PENDING
        doc.current_step += 1
    else:
        # 所有步驟完成
        doc.status = DocumentStatus.APPROVED
        doc.completed_at = now
        logger.info("公文核准完成 serial=%s", doc.serial_number)

    await session.flush()
    return doc


# ── 狀態機：退件 ───────────────────────────────────────────────────────────────


async def reject_step(
    session: AsyncSession,
    doc: Document,
    *,
    approver_id: uuid.UUID,
    comment: str,
) -> Document:
    """退件：將文件改為 REJECTED，所有後續步驟設為 SKIPPED"""
    if doc.status != DocumentStatus.PENDING:
        msg = f"公文 {doc.serial_number} 非待審核狀態"
        raise ValueError(msg)

    current_approval, is_acting = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        msg = "找不到對應的審核步驟，或您不是此步驟的審核人（含代理）"
        raise PermissionError(msg)

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.REJECTED
    current_approval.comment = comment
    current_approval.decided_at = now
    current_approval.is_acting = is_acting

    # 後續步驟全部跳過
    result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order > doc.current_step,
        )
    )
    for remaining in result.scalars().all():
        remaining.status = ApprovalStepStatus.SKIPPED

    doc.status = DocumentStatus.REJECTED
    doc.completed_at = now
    await session.flush()
    logger.info("公文退件至承辦人 serial=%s by=%s", doc.serial_number, approver_id)
    return doc


# ── 狀態機：退回至上一關 ────────────────────────────────────────────────────────


async def reject_to_previous_step(
    session: AsyncSession,
    doc: Document,
    *,
    approver_id: uuid.UUID,
    comment: str,
) -> Document:
    """
    退回至上一關（公文維持 PENDING 狀態，流程繼續）。
    - 將當前步驟標為 REJECTED（此關退回）
    - 將上一關狀態重設為 PENDING（重新輪到上一關審核人）
    - 若已在第一關，則強制退回至承辦人（呼叫 reject_step）

    規格依據：「退件機制：審核者可退回至承辦人，或退回至上一關核稿人」
    """
    if doc.status != DocumentStatus.PENDING:
        msg = f"公文 {doc.serial_number} 非待審核狀態"
        raise ValueError(msg)

    current_approval, is_acting = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        msg = "找不到對應的審核步驟，或您不是此步驟的審核人（含代理）"
        raise PermissionError(msg)

    # 第一關無法退回上一關，自動轉為退件至承辦人
    if doc.current_step <= 1:
        msg = "已在第一關，請使用「退件至承辦人」"
        raise ValueError(msg)

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.REJECTED
    current_approval.comment = comment
    current_approval.decided_at = now
    current_approval.is_acting = is_acting

    # 找到並重新啟動上一關
    prev_result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == doc.current_step - 1,
        )
    )
    prev_approval = prev_result.scalar_one_or_none()
    if prev_approval:
        await _apply_assignment_delegate_to_approval(session, prev_approval, org_id=doc.org_id)
        prev_approval.status = ApprovalStepStatus.PENDING
        prev_approval.decided_at = None  # 清除上一關的決定紀錄
        prev_approval.comment = None

    doc.current_step -= 1
    # doc.status 保持 PENDING（流程繼續）
    await session.flush()
    logger.info(
        "公文退回至上一關 serial=%s step=%d by=%s",
        doc.serial_number,
        doc.current_step,
        approver_id,
    )
    return doc


# ── 受文者管理 ─────────────────────────────────────────────────────────────────


async def upsert_recipients(
    session: AsyncSession,
    doc: Document,
    *,
    recipients: list[RecipientCreate],
) -> list[DocumentRecipient]:
    """
    整批更新受文者清單（先刪全部，再新增）。
    僅允許在草稿狀態下操作。
    """
    if doc.status != DocumentStatus.DRAFT:
        raise ValueError("只有草稿狀態的公文可以修改受文者")

    # 刪除舊有
    old_result = await session.execute(
        select(DocumentRecipient).where(DocumentRecipient.document_id == doc.id)
    )
    for old in old_result.scalars().all():
        await session.delete(old)

    # 新增
    new_recipients: list[DocumentRecipient] = []
    for r in recipients:
        rec = DocumentRecipient(
            document_id=doc.id,
            recipient_type=r.recipient_type,
            name=r.name,
            email=r.email,
        )
        session.add(rec)
        new_recipients.append(rec)

    await session.flush()
    return new_recipients


# ── 狀態機：撤回 ───────────────────────────────────────────────────────────────


async def recall_document(
    session: AsyncSession,
    doc: Document,
    *,
    requested_by: uuid.UUID,
) -> Document:
    """
    撤回送審：待審核 → 草稿。
    僅建立者可撤回，且僅允許在第一關尚未審核（current_step == 1 且步驟仍為 PENDING）時操作。
    撤回後所有審核步驟刪除，文件回到草稿可繼續編輯。
    """
    if doc.status != DocumentStatus.PENDING:
        msg = f"公文 {doc.serial_number} 非待審核狀態，無法撤回"
        raise ValueError(msg)
    if doc.created_by != requested_by:
        msg = "只有建立者可以撤回公文"
        raise PermissionError(msg)

    # 確認第一關尚未做出決定
    result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == 1,
        )
    )
    first_step = result.scalar_one_or_none()
    if first_step and first_step.status != ApprovalStepStatus.PENDING:
        msg = "第一關審核人已開始審核，無法撤回"
        raise ValueError(msg)

    # 刪除所有審核步驟
    all_steps_result = await session.execute(
        select(DocumentApproval).where(DocumentApproval.document_id == doc.id)
    )
    for step in all_steps_result.scalars().all():
        await session.delete(step)

    doc.status = DocumentStatus.DRAFT
    doc.submitted_at = None
    doc.current_step = 0
    await session.flush()
    logger.info("公文撤回 serial=%s by=%s", doc.serial_number, requested_by)
    return doc


# ── 狀態機：封存 ───────────────────────────────────────────────────────────────


async def archive_document(
    session: AsyncSession,
    doc: Document,
    *,
    requested_by: uuid.UUID,
) -> Document:
    """
    封存公文：已核准 → 封存（ARCHIVED）。
    僅建立者或管理員可封存已核准的公文。
    封存後不可再異動（終態）。
    """
    if doc.status != DocumentStatus.APPROVED:
        msg = f"公文 {doc.serial_number} 非已核准狀態，無法封存（目前狀態：{doc.status}）"
        raise ValueError(msg)

    now = datetime.now(UTC)
    doc.status = DocumentStatus.ARCHIVED
    doc.completed_at = doc.completed_at or now
    await session.flush()
    logger.info("公文封存 serial=%s by=%s", doc.serial_number, requested_by)
    return doc


async def delete_document(
    session: AsyncSession,
    doc: Document,
) -> None:
    """刪除草稿公文（僅允許 DRAFT）。"""
    if doc.status != DocumentStatus.DRAFT:
        msg = f"公文 {doc.serial_number} 非草稿狀態，無法刪除"
        raise ValueError(msg)
    await session.delete(doc)
    await session.flush()


# ── 請假代行授權 ───────────────────────────────────────────────────────────────


async def list_approval_delegations(
    session: AsyncSession,
    *,
    principal_user_id: uuid.UUID | None = None,
    delegate_user_id: uuid.UUID | None = None,
    org_id: uuid.UUID | None = None,
    active_only: bool = True,
) -> list[DocumentApprovalDelegation]:
    q = _delegation_query_with_relations().order_by(
        DocumentApprovalDelegation.start_at.desc(),
        DocumentApprovalDelegation.created_at.desc(),
    )
    if principal_user_id is not None:
        q = q.where(DocumentApprovalDelegation.principal_user_id == principal_user_id)
    if delegate_user_id is not None:
        q = q.where(DocumentApprovalDelegation.delegate_user_id == delegate_user_id)
    if org_id is not None:
        q = q.where(DocumentApprovalDelegation.org_id == org_id)
    if active_only:
        q = q.where(DocumentApprovalDelegation.is_active.is_(True))
    result = await session.execute(q)
    return list(result.scalars().all())


async def get_approval_delegation(
    session: AsyncSession,
    delegation_id: uuid.UUID,
) -> DocumentApprovalDelegation | None:
    result = await session.execute(
        _delegation_query_with_relations().where(DocumentApprovalDelegation.id == delegation_id)
    )
    return result.scalar_one_or_none()


async def create_approval_delegation(
    session: AsyncSession,
    *,
    principal_user_id: uuid.UUID,
    created_by: uuid.UUID,
    data: DocumentApprovalDelegationCreate,
) -> DocumentApprovalDelegation:
    if principal_user_id == data.delegate_user_id:
        raise ValueError("代理人不得與被代理人相同")
    if not await _has_active_org_membership(session, principal_user_id, data.org_id, data.start_at):
        raise ValueError("被代理人目前不是該組織的有效成員")
    if not await _has_active_org_membership(
        session, data.delegate_user_id, data.org_id, data.start_at
    ):
        raise ValueError("代理人目前不是該組織的有效成員")

    overlap_filters = [
        DocumentApprovalDelegation.principal_user_id == principal_user_id,
        DocumentApprovalDelegation.org_id == data.org_id,
        DocumentApprovalDelegation.is_active.is_(True),
        or_(
            DocumentApprovalDelegation.end_at.is_(None),
            DocumentApprovalDelegation.end_at >= data.start_at,
        ),
    ]
    if data.end_at is not None:
        overlap_filters.append(DocumentApprovalDelegation.start_at <= data.end_at)
    overlap = await session.execute(
        select(DocumentApprovalDelegation.id).where(*overlap_filters).limit(1)
    )
    if overlap.scalar_one_or_none() is not None:
        raise ValueError("此期間已有有效的請假代理授權，請先調整既有設定")

    delegation = DocumentApprovalDelegation(
        org_id=data.org_id,
        principal_user_id=principal_user_id,
        delegate_user_id=data.delegate_user_id,
        start_at=data.start_at,
        end_at=data.end_at,
        reason=data.reason,
        is_active=True,
        created_by=created_by,
    )
    session.add(delegation)
    await session.flush()
    await _sync_pending_approval_delegations(
        session,
        principal_user_id=principal_user_id,
        org_id=data.org_id,
    )
    await session.flush()
    loaded = await get_approval_delegation(session, delegation.id)
    assert loaded is not None
    return loaded


async def update_approval_delegation(
    session: AsyncSession,
    delegation: DocumentApprovalDelegation,
    *,
    data: DocumentApprovalDelegationUpdate,
) -> DocumentApprovalDelegation:
    payload = data.model_dump(exclude_unset=True)
    next_delegate = payload.get("delegate_user_id", delegation.delegate_user_id)
    next_start = payload.get("start_at", delegation.start_at)
    next_end = payload.get("end_at", delegation.end_at)
    next_active = payload.get("is_active", delegation.is_active)
    if next_delegate == delegation.principal_user_id:
        raise ValueError("代理人不得與被代理人相同")
    if next_end and next_end < next_start:
        raise ValueError("代理結束時間不得早於開始時間")
    if next_active:
        if not await _has_active_org_membership(
            session, delegation.principal_user_id, delegation.org_id, next_start
        ):
            raise ValueError("被代理人目前不是該組織的有效成員")
        if not await _has_active_org_membership(
            session, next_delegate, delegation.org_id, next_start
        ):
            raise ValueError("代理人目前不是該組織的有效成員")
        overlap_filters = [
            DocumentApprovalDelegation.id != delegation.id,
            DocumentApprovalDelegation.principal_user_id == delegation.principal_user_id,
            DocumentApprovalDelegation.org_id == delegation.org_id,
            DocumentApprovalDelegation.is_active.is_(True),
            or_(
                DocumentApprovalDelegation.end_at.is_(None),
                DocumentApprovalDelegation.end_at >= next_start,
            ),
        ]
        if next_end is not None:
            overlap_filters.append(DocumentApprovalDelegation.start_at <= next_end)
        overlap = await session.execute(
            select(DocumentApprovalDelegation.id).where(*overlap_filters).limit(1)
        )
        if overlap.scalar_one_or_none() is not None:
            raise ValueError("更新後的期間與其他有效代理授權重疊")

    for field, value in payload.items():
        setattr(delegation, field, value)

    await session.flush()
    await _sync_pending_approval_delegations(
        session,
        principal_user_id=delegation.principal_user_id,
        org_id=delegation.org_id,
    )
    await session.flush()
    loaded = await get_approval_delegation(session, delegation.id)
    assert loaded is not None
    return loaded


async def deactivate_approval_delegation(
    session: AsyncSession,
    delegation: DocumentApprovalDelegation,
) -> None:
    delegation.is_active = False
    await session.flush()
    await _sync_pending_approval_delegations(
        session,
        principal_user_id=delegation.principal_user_id,
        org_id=delegation.org_id,
    )
    await session.flush()


# ── 代理人設定 ─────────────────────────────────────────────────────────────────


async def set_delegate(
    session: AsyncSession,
    doc: Document,
    *,
    step_order: int,
    requesting_user_id: uuid.UUID,
    delegate_id: uuid.UUID | None,
) -> DocumentApproval:
    """
    為指定審核步驟設定（或清除）代理人。
    只有原始審核人可以設定代理人。
    """
    result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == step_order,
            DocumentApproval.approver_id == requesting_user_id,
        )
    )
    approval = result.scalar_one_or_none()
    if approval is None:
        msg = "您不是此審核步驟的原始審核人，無法設定代理"
        raise PermissionError(msg)
    if approval.status not in (ApprovalStepStatus.PENDING, ApprovalStepStatus.WAITING):
        msg = "此步驟已完成，無法變更代理人"
        raise ValueError(msg)

    approval.delegate_id = delegate_id
    approval.delegate_source = DelegateSource.MANUAL if delegate_id else None
    if delegate_id is None:
        await _apply_assignment_delegate_to_approval(session, approval, org_id=doc.org_id)
    await session.flush()
    logger.info(
        "設定代理人 doc=%s step=%d delegate=%s",
        doc.serial_number,
        step_order,
        delegate_id,
    )
    return approval


# ── 私有輔助 ────────────────────────────────────────────────────────────────────


async def _get_current_approval(
    session: AsyncSession,
    doc: Document,
    approver_id: uuid.UUID,
) -> tuple[DocumentApproval, bool] | tuple[None, bool]:
    """
    回傳 (approval, is_acting) 或 (None, False)。
    is_acting=True 表示 approver_id 是代理人而非主審核人。
    """
    from sqlalchemy import or_

    result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == doc.current_step,
            DocumentApproval.status == ApprovalStepStatus.PENDING,
            or_(
                DocumentApproval.approver_id == approver_id,
                DocumentApproval.delegate_id == approver_id,
            ),
        )
    )
    approval = result.scalar_one_or_none()
    if approval is None:
        return None, False
    if approval.delegate_source == DelegateSource.ASSIGNMENT:
        assignment = await _resolve_active_delegate_assignment(
            session,
            principal_user_id=approval.approver_id,
            org_id=doc.org_id,
        )
        current_delegate_id = assignment.delegate_user_id if assignment else None
        if approver_id == approval.approver_id:
            return approval, False
        if current_delegate_id is not None and approver_id == current_delegate_id:
            approval.delegate_id = current_delegate_id
            approval.delegate_source = DelegateSource.ASSIGNMENT
            return approval, True
        return None, False
    is_acting = approval.approver_id != approver_id
    return approval, is_acting
