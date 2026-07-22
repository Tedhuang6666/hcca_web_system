"""公文 CRUD / 狀態機 / 審核 / 代行授權 / 受文者"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.prometheus_metrics import record_document_approval
from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
    DocumentCategory,
    DocumentRecipient,
    DocumentRevision,
    DocumentStatus,
    DocumentVisibility,
    RecipientType,
)
from api.models.org import Org
from api.models.school_class import SchoolClass
from api.schemas.document import (
    DocumentApprovalDelegationCreate,
    DocumentApprovalDelegationUpdate,
    DocumentArchiveSettingsUpdate,
    DocumentCreate,
    DocumentUpdate,
    RecipientCreate,
)
from api.services.document._access import (
    _apply_assignment_delegate_to_approval,
    _delegation_query_with_relations,
    _has_active_class_membership,
    _has_active_org_membership,
    _resolve_active_delegate_assignment,
    _sync_pending_approval_delegations,
    get_approval_delegation,
    get_document,
)
from api.services.document._serial import generate_serial_from_template, get_serial_template
from api.services.permission import active_tenure_filter

logger = logging.getLogger(__name__)

PRIMARY_RECIPIENT_TYPES = frozenset({RecipientType.MAIN, RecipientType.PRIMARY})


async def _validate_recipient_targets(
    session: AsyncSession,
    recipients: list[RecipientCreate],
) -> None:
    class_ids = {recipient.target_class_id for recipient in recipients if recipient.target_class_id}
    if class_ids:
        result = await session.execute(
            select(SchoolClass.id).where(
                SchoolClass.id.in_(class_ids),
                SchoolClass.is_active.is_(True),
            )
        )
        found_class_ids = set(result.scalars().all())
        if found_class_ids != class_ids:
            raise ValueError("受文班級不存在或已停用")

    org_ids = {recipient.target_org_id for recipient in recipients if recipient.target_org_id}
    if org_ids:
        class_org_result = await session.execute(
            select(SchoolClass.org_id).where(SchoolClass.org_id.in_(org_ids))
        )
        if set(class_org_result.scalars().all()):
            raise ValueError("班級受文者請使用 target_class_id，不可當作自治組織")

    if org_ids:
        existing_org_ids = set(
            (await session.execute(select(Org.id).where(Org.id.in_(org_ids)))).scalars().all()
        )
        if existing_org_ids != org_ids:
            raise ValueError("受文自治組織不存在")


async def create_document(
    session: AsyncSession,
    *,
    data: DocumentCreate,
    created_by: uuid.UUID,
) -> Document:
    from api.models.document import DocumentSerialTemplate

    is_class_org = await session.scalar(
        select(SchoolClass.id).where(SchoolClass.org_id == data.org_id).limit(1)
    )
    if is_class_org is not None:
        raise ValueError("班級不是發文機關，請改選自治組織")
    await _validate_recipient_targets(session, data.recipients)

    template: DocumentSerialTemplate | None = None
    manual_serial = data.manual_serial_number.strip() if data.manual_serial_number else None
    if manual_serial:
        existing = await session.scalar(
            select(Document.id).where(Document.serial_number == manual_serial)
        )
        if existing is not None:
            raise ValueError("指定的公文字號已存在，請更換字號")
        serial = manual_serial
    else:
        if data.serial_template_id is None:
            serial = f"DRAFT-{datetime.now(UTC):%Y%m%d}-{uuid.uuid4().hex[:8].upper()}"
        else:
            template = await get_serial_template(session, data.serial_template_id)
            if template is None or not template.is_active:
                raise ValueError("指定的字號模板不存在或已停用")
            if template.org_id != data.org_id:
                raise PermissionError("字號模板不屬於此組織，無法使用")
            serial = await generate_serial_from_template(session, template)

    visibility = data.visibility_level
    doc = Document(
        serial_number=serial,
        title=data.title,
        issuer_full_name=data.issuer_full_name,
        org_id=data.org_id,
        activity_id=data.activity_id,
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
    await session.flush()

    rev = DocumentRevision(
        document_id=doc.id,
        revision_number=1,
        title=doc.title,
        content=doc.content,
        change_note="初稿建立",
        changed_by=created_by,
    )
    session.add(rev)

    for r in data.recipients:
        session.add(
            DocumentRecipient(
                document_id=doc.id,
                recipient_type=r.recipient_type,
                name=r.name,
                email=r.email,
                target_user_id=r.target_user_id,
                target_org_id=r.target_org_id,
                target_class_id=r.target_class_id,
                delivery_method=r.delivery_method,
            )
        )

    await session.flush()
    logger.info("公文建立 serial=%s id=%s", serial, doc.id)

    loaded = await get_document(session, doc.id)
    if loaded is None:
        raise RuntimeError(f"公文建立後無法讀回 id={doc.id}")
    return loaded


async def update_document(
    session: AsyncSession,
    doc: Document,
    *,
    data: DocumentUpdate,
    changed_by: uuid.UUID,
) -> Document:
    if doc.status != DocumentStatus.DRAFT:
        raise ValueError(f"公文 {doc.serial_number} 非草稿狀態（{doc.status}），無法編輯")

    changed = False
    update_fields = data.model_dump(exclude_unset=True, exclude={"change_note", "autosave"})
    for field, value in update_fields.items():
        if getattr(doc, field, None) != value:
            setattr(doc, field, value)
            changed = True
    if doc.category == DocumentCategory.DECREE and not (doc.issuer_full_name or "").strip():
        doc.issuer_full_name = "主席"
        changed = True
    if "visibility_level" in update_fields:
        doc.is_public = doc.visibility_level == DocumentVisibility.PUBLICLY_OPEN

    if changed and not data.autosave:
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
    record_document_approval("approved")
    return doc


async def submit_document(
    session: AsyncSession,
    doc: Document,
    *,
    approver_ids: list[uuid.UUID],
) -> Document:
    if doc.status != DocumentStatus.DRAFT:
        raise ValueError(f"公文 {doc.serial_number} 非草稿狀態，無法送審")
    if not approver_ids:
        raise ValueError("送審至少需要一位審核人")

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


async def issue_document_directly(
    session: AsyncSession,
    doc: Document,
    *,
    issued_by: uuid.UUID,
    comment: str | None = None,
) -> Document:
    if doc.status != DocumentStatus.DRAFT:
        raise ValueError(f"公文 {doc.serial_number} 非草稿狀態，無法直接發文")

    now = datetime.now(UTC)
    doc.status = DocumentStatus.APPROVED
    doc.issued_at = now
    doc.submitted_at = now
    doc.completed_at = now

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


async def suggest_approvers(
    session: AsyncSession,
    org_id: uuid.UUID,
) -> list:
    from api.models.org import Permission, Position, UserPosition
    from api.models.user import User as UserModel

    today = local_today()
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


async def _lock_document(session: AsyncSession, doc: Document) -> None:
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        await session.execute(select(Document.id).where(Document.id == doc.id).with_for_update())
    await session.refresh(doc)


async def approve_step(
    session: AsyncSession,
    doc: Document,
    *,
    approver_id: uuid.UUID,
    comment: str | None = None,
) -> Document:
    await _lock_document(session, doc)
    if doc.status != DocumentStatus.PENDING:
        raise ValueError(f"公文 {doc.serial_number} 非待審核狀態")

    current_approval, is_acting = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        raise PermissionError("找不到對應的審核步驟，或您不是此步驟的審核人（含代理）")

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.APPROVED
    current_approval.comment = comment
    current_approval.decided_at = now
    current_approval.is_acting = is_acting

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
        doc.status = DocumentStatus.APPROVED
        doc.completed_at = now
        logger.info("公文核准完成 serial=%s", doc.serial_number)

    await session.flush()
    return doc


async def reject_step(
    session: AsyncSession,
    doc: Document,
    *,
    approver_id: uuid.UUID,
    comment: str,
) -> Document:
    await _lock_document(session, doc)
    if doc.status != DocumentStatus.PENDING:
        raise ValueError(f"公文 {doc.serial_number} 非待審核狀態")

    current_approval, is_acting = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        raise PermissionError("找不到對應的審核步驟，或您不是此步驟的審核人（含代理）")

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.REJECTED
    current_approval.comment = comment
    current_approval.decided_at = now
    current_approval.is_acting = is_acting

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
    record_document_approval("rejected")
    logger.info("公文退件至承辦人 serial=%s by=%s", doc.serial_number, approver_id)
    return doc


async def reject_to_previous_step(
    session: AsyncSession,
    doc: Document,
    *,
    approver_id: uuid.UUID,
    comment: str,
) -> Document:
    await _lock_document(session, doc)
    if doc.status != DocumentStatus.PENDING:
        raise ValueError(f"公文 {doc.serial_number} 非待審核狀態")

    current_approval, is_acting = await _get_current_approval(session, doc, approver_id)
    if current_approval is None:
        raise PermissionError("找不到對應的審核步驟，或您不是此步驟的審核人（含代理）")

    if doc.current_step <= 1:
        raise ValueError("已在第一關，請使用「退件至承辦人」")

    now = datetime.now(UTC)
    current_approval.status = ApprovalStepStatus.REJECTED
    current_approval.comment = comment
    current_approval.decided_at = now
    current_approval.is_acting = is_acting

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
        prev_approval.decided_at = None
        prev_approval.comment = None

    doc.current_step -= 1
    await session.flush()
    logger.info(
        "公文退回至上一關 serial=%s step=%d by=%s",
        doc.serial_number,
        doc.current_step,
        approver_id,
    )
    return doc


async def upsert_recipients(
    session: AsyncSession,
    doc: Document,
    *,
    recipients: list[RecipientCreate],
) -> list[DocumentRecipient]:
    if doc.status != DocumentStatus.DRAFT:
        raise ValueError("只有草稿狀態的公文可以修改受文者")
    await _validate_recipient_targets(session, recipients)

    old_result = await session.execute(
        select(DocumentRecipient).where(DocumentRecipient.document_id == doc.id)
    )
    for old in old_result.scalars().all():
        await session.delete(old)

    new_recipients: list[DocumentRecipient] = []
    for r in recipients:
        rec = DocumentRecipient(
            document_id=doc.id,
            recipient_type=r.recipient_type,
            name=r.name,
            email=r.email,
            target_user_id=r.target_user_id,
            target_org_id=r.target_org_id,
            target_class_id=r.target_class_id,
            delivery_method=r.delivery_method,
        )
        session.add(rec)
        new_recipients.append(rec)

    await session.flush()
    return new_recipients


async def recall_document(
    session: AsyncSession,
    doc: Document,
    *,
    requested_by: uuid.UUID,
) -> Document:
    if doc.status != DocumentStatus.PENDING:
        raise ValueError(f"公文 {doc.serial_number} 非待審核狀態，無法撤回")
    if doc.created_by != requested_by:
        raise PermissionError("只有建立者可以撤回公文")

    result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == 1,
        )
    )
    first_step = result.scalar_one_or_none()
    if first_step and first_step.status != ApprovalStepStatus.PENDING:
        raise ValueError("第一關審核人已開始審核，無法撤回")

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


async def archive_document(
    session: AsyncSession,
    doc: Document,
    *,
    requested_by: uuid.UUID,
) -> Document:
    if doc.status != DocumentStatus.APPROVED:
        raise ValueError(
            f"公文 {doc.serial_number} 非已核准狀態，無法封存（目前狀態：{doc.status}）"
        )

    now = datetime.now(UTC)
    doc.status = DocumentStatus.ARCHIVED
    doc.completed_at = doc.completed_at or now
    await session.flush()
    logger.info("公文封存 serial=%s by=%s", doc.serial_number, requested_by)
    return doc


async def update_archive_settings(
    session: AsyncSession,
    doc: Document,
    *,
    data: DocumentArchiveSettingsUpdate,
) -> Document:
    if doc.status != DocumentStatus.APPROVED:
        raise ValueError(
            f"公文 {doc.serial_number} 非已核准狀態，無法設定預約歸檔（目前狀態：{doc.status}）"
        )

    archive_at = data.archive_at
    if archive_at is not None:
        if archive_at.tzinfo is None:
            archive_at = archive_at.replace(tzinfo=UTC)
        archive_at = archive_at.astimezone(UTC)
        if archive_at <= datetime.now(UTC):
            raise ValueError("預約歸檔時間必須晚於現在")

    doc.archive_at = archive_at
    await session.flush()
    logger.info("設定公文預約歸檔 serial=%s archive_at=%s", doc.serial_number, archive_at)
    return doc


async def delete_document(
    session: AsyncSession,
    doc: Document,
) -> None:
    if doc.status != DocumentStatus.DRAFT:
        raise ValueError(f"公文 {doc.serial_number} 非草稿狀態，無法刪除")
    await session.delete(doc)
    await session.flush()


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
    if loaded is None:
        raise RuntimeError(f"委辦設定建立後無法讀回 id={delegation.id}")
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
    if loaded is None:
        raise RuntimeError(f"委辦設定建立後無法讀回 id={delegation.id}")
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


async def set_delegate(
    session: AsyncSession,
    doc: Document,
    *,
    step_order: int,
    requesting_user_id: uuid.UUID,
    delegate_id: uuid.UUID | None,
) -> DocumentApproval:
    result = await session.execute(
        select(DocumentApproval).where(
            DocumentApproval.document_id == doc.id,
            DocumentApproval.step_order == step_order,
            DocumentApproval.approver_id == requesting_user_id,
        )
    )
    approval = result.scalar_one_or_none()
    if approval is None:
        raise PermissionError("您不是此審核步驟的原始審核人，無法設定代理")
    if approval.status not in (ApprovalStepStatus.PENDING, ApprovalStepStatus.WAITING):
        raise ValueError("此步驟已完成，無法變更代理人")

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


async def _get_current_approval(
    session: AsyncSession,
    doc: Document,
    approver_id: uuid.UUID,
) -> tuple[DocumentApproval, bool] | tuple[None, bool]:
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


async def resolve_recipient_match(
    session: AsyncSession,
    doc: Document,
    viewer_id: uuid.UUID,
) -> DocumentRecipient | None:
    if not doc.recipients:
        return None

    for r in doc.recipients:
        if r.target_user_id == viewer_id:
            return r
        if r.target_org_id is not None and await _has_active_org_membership(
            session, viewer_id, r.target_org_id
        ):
            return r
        if r.target_class_id is not None and await _has_active_class_membership(
            session, viewer_id, r.target_class_id
        ):
            return r
    return None


def is_primary_variant(recipient: DocumentRecipient) -> bool:
    return recipient.recipient_type in PRIMARY_RECIPIENT_TYPES


async def get_recipient_for_admin(
    session: AsyncSession,
    doc: Document,
    recipient_id: uuid.UUID,
) -> DocumentRecipient | None:
    from sqlalchemy import select

    result = await session.execute(
        select(DocumentRecipient).where(
            DocumentRecipient.id == recipient_id,
            DocumentRecipient.document_id == doc.id,
        )
    )
    return result.scalar_one_or_none()
