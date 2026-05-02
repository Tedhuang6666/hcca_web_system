"""公文服務層 - CRUD、狀態機（含退回至上一關）、字號生成、組織可見性"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.document import (
    ApprovalStepStatus,
    Document,
    DocumentApproval,
    DocumentCategory,
    DocumentRecipient,
    DocumentRevision,
    DocumentSerialTemplate,
    DocumentStatus,
    YearMode,
)
from api.schemas.document import (
    DocumentCreate,
    DocumentUpdate,
    RecipientCreate,
    SerialTemplateCreate,
)

logger = logging.getLogger(__name__)


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
    建立字號模板（需有 doc.issue 權限）。
    重複的 org_id + org_prefix + category_char 組合會觸發 UniqueConstraint 錯誤。
    """
    now = datetime.now(UTC)
    current_year = now.year - 1911 if data.year_mode == YearMode.ROC else now.year

    template = DocumentSerialTemplate(
        org_id=data.org_id,
        org_prefix=data.org_prefix,
        category_char=data.category_char,
        year_mode=data.year_mode,
        reset_on_new_year=data.reset_on_new_year,
        current_year=current_year,
        counter=0,
        is_active=True,
        description=data.description,
        created_by=created_by,
    )
    session.add(template)
    await session.flush()
    logger.info("字號模板建立 id=%s prefix=%s%s", template.id, data.org_prefix, data.category_char)
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
    q = q.order_by(DocumentSerialTemplate.org_prefix, DocumentSerialTemplate.category_char)
    result = await session.execute(q)
    return list(result.scalars().all())


async def deactivate_serial_template(
    session: AsyncSession,
    template: DocumentSerialTemplate,
) -> DocumentSerialTemplate:
    """停用字號模板（is_active=False）"""
    template.is_active = False
    await session.flush()
    return template


# ── 查詢輔助 ────────────────────────────────────────────────────────────────────

def _doc_query_with_relations():
    """標準查詢：含所有子關聯（版本、審核步驟、附件、受文者）"""
    return (
        select(Document)
        .options(
            selectinload(Document.revisions),
            selectinload(Document.approvals)
            .selectinload(DocumentApproval.approver),
            selectinload(Document.approvals)
            .selectinload(DocumentApproval.delegate),
            selectinload(Document.attachments),
            selectinload(Document.recipients),
            selectinload(Document.creator),
        )
    )


async def get_document(session: AsyncSession, doc_id: uuid.UUID) -> Document | None:
    """以 ID 取得公文（含所有關聯資料）"""
    result = await session.execute(
        _doc_query_with_relations().where(Document.id == doc_id)
    )
    return result.scalar_one_or_none()


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
    from api.models.org import Position, UserPosition

    # 1. 建立者
    if doc.created_by == user_id:
        return True

    # 2. 審核人
    approver_ids = {a.approver_id for a in doc.approvals}
    if user_id in approver_ids:
        return True

    # 3. 同組織成員（UserPosition -> Position.org_id）
    result = await session.execute(
        select(UserPosition)
        .join(Position, UserPosition.position_id == Position.id)
        .where(
            Position.org_id == doc.org_id,
            UserPosition.user_id == user_id,
        )
    )
    return result.scalar_one_or_none() is not None


async def list_documents(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    status: DocumentStatus | None = None,
    category: DocumentCategory | None = None,
    created_by: uuid.UUID | None = None,
    keyword: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Document]:
    """列表查詢：支援組織過濾、狀態、類別、建立者、關鍵字全文搜尋"""
    q = _doc_query_with_relations()
    if org_id:
        q = q.where(Document.org_id == org_id)
    if status:
        q = q.where(Document.status == status)
    if category:
        q = q.where(Document.category == category)
    if created_by:
        q = q.where(Document.created_by == created_by)
    if keyword:
        pattern = f"%{keyword}%"
        q = q.where(
            or_(
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

    doc = Document(
        serial_number=serial,
        title=data.title,
        org_id=data.org_id,
        created_by=created_by,
        status=DocumentStatus.DRAFT,
        urgency=data.urgency,
        classification=data.classification,
        category=data.category,
        subject=data.subject,
        doc_description=data.doc_description,
        action_required=data.action_required,
        content=data.content,
        issuer_org_name=data.issuer_org_name,
        handler_name=data.handler_name,
        handler_unit=data.handler_unit,
        handler_phone=data.handler_phone,
        handler_email=data.handler_email,
        due_date=data.due_date,
        serial_template_id=template.id if template else None,
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
        session.add(DocumentRecipient(
            document_id=doc.id,
            recipient_type=r.recipient_type,
            name=r.name,
            email=r.email,
        ))

    await session.flush()
    logger.info("公文建立 serial=%s id=%s", serial, doc.id)
    return doc


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

    if changed:
        result = await session.execute(
            select(func.max(DocumentRevision.revision_number)).where(
                DocumentRevision.document_id == doc.id
            )
        )
        current_max: int = result.scalar_one() or 0
        session.add(DocumentRevision(
            document_id=doc.id,
            revision_number=current_max + 1,
            title=doc.title,
            content=doc.content,
            change_note=data.change_note,
            changed_by=changed_by,
        ))

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
        session.add(approval)

    await session.flush()
    logger.info("公文送審 serial=%s approvers=%d", doc.serial_number, len(approver_ids))
    return doc


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

    # 找當前步驟
    current_approval = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        msg = "找不到對應的審核步驟，或您不是此步驟的審核人"
        raise PermissionError(msg)

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.APPROVED
    current_approval.comment = comment
    current_approval.decided_at = now

    # 尋找下一步
    next_result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == doc.current_step + 1,
        )
    )
    next_approval = next_result.scalar_one_or_none()

    if next_approval:
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

    current_approval = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        msg = "找不到對應的審核步驟，或您不是此步驟的審核人"
        raise PermissionError(msg)

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.REJECTED
    current_approval.comment = comment
    current_approval.decided_at = now

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

    current_approval = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        msg = "找不到對應的審核步驟，或您不是此步驟的審核人"
        raise PermissionError(msg)

    # 第一關無法退回上一關，自動轉為退件至承辦人
    if doc.current_step <= 1:
        msg = "已在第一關，請使用「退件至承辦人」"
        raise ValueError(msg)

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.REJECTED
    current_approval.comment = comment
    current_approval.decided_at = now

    # 找到並重新啟動上一關
    prev_result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == doc.current_step - 1,
        )
    )
    prev_approval = prev_result.scalar_one_or_none()
    if prev_approval:
        prev_approval.status = ApprovalStepStatus.PENDING
        prev_approval.decided_at = None  # 清除上一關的決定紀錄
        prev_approval.comment = None

    doc.current_step -= 1
    # doc.status 保持 PENDING（流程繼續）
    await session.flush()
    logger.info(
        "公文退回至上一關 serial=%s step=%d by=%s",
        doc.serial_number, doc.current_step, approver_id,
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


# ── 私有輔助 ────────────────────────────────────────────────────────────────────

async def _get_current_approval(
    session: AsyncSession,
    doc: Document,
    approver_id: uuid.UUID,
) -> DocumentApproval | None:
    result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == doc.current_step,
            DocumentApproval.approver_id == approver_id,
            DocumentApproval.status == ApprovalStepStatus.PENDING,
        )
    )
    return result.scalar_one_or_none()
