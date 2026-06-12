"""企劃書 / 職務指派 / 工作流程範本 / 自動化規則 / 儀表板"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.governance import (
    AutomationRule,
    CaseStatus,
    Decision,
    DecisionStatus,
    GovernanceCase,
    GovernanceWorkflowTemplate,
    Matter,
    MatterRoleAssignment,
    MatterStatus,
    PlanningDocument,
    PlanningDocumentAttachment,
    PlanningDocumentRevision,
    PlanningDocumentRevisionAttachment,
    PlanningDocumentStatus,
)
from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus
from api.schemas.governance import (
    AutomationRuleCreate,
    AutomationRuleUpdate,
    GovernanceWorkflowTemplateCreate,
    MatterRoleAssignmentCreate,
    MatterRoleAssignmentUpdate,
    PlanningDocumentCreate,
    PlanningDocumentRevisionCreate,
    PlanningDocumentUpdate,
)
from api.services._base import apply_updates
from api.services.governance._events import record_event
from api.services.governance._matter import list_matters


async def create_planning_document(
    db: AsyncSession, *, matter: Matter, data: PlanningDocumentCreate, user: User
) -> PlanningDocument:
    payload = data.model_dump(
        exclude={
            "version_label",
            "content",
            "change_reason",
            "attachment_ids",
            "primary_attachment_id",
        }
    )
    document = PlanningDocument(matter_id=matter.id, **payload, created_by_id=user.id)
    db.add(document)
    await db.flush()
    revision = PlanningDocumentRevision(
        document_id=document.id,
        version_number=1,
        version_label=data.version_label,
        content=data.content,
        change_reason=data.change_reason,
        created_by_id=user.id,
    )
    db.add(revision)
    await db.flush()
    await _set_revision_attachments(
        db,
        document=document,
        revision=revision,
        attachment_ids=data.attachment_ids,
        primary_attachment_id=data.primary_attachment_id,
    )
    await record_event(
        db,
        matter_id=matter.id,
        case_id=document.case_id,
        event_type="planning_document",
        title=f"新增企劃書：{document.title}",
        actor=user,
        payload={"planning_document_id": str(document.id)},
    )
    return document


async def get_planning_document(
    db: AsyncSession, document_id: uuid.UUID
) -> PlanningDocument | None:
    result = await db.execute(
        select(PlanningDocument)
        .options(
            selectinload(PlanningDocument.attachments),
            selectinload(PlanningDocument.revisions)
            .selectinload(PlanningDocumentRevision.attachment_links)
            .selectinload(PlanningDocumentRevisionAttachment.attachment),
        )
        .where(PlanningDocument.id == document_id, PlanningDocument.is_active.is_(True))
    )
    return result.scalar_one_or_none()


async def update_planning_document(
    db: AsyncSession, *, document: PlanningDocument, data: PlanningDocumentUpdate, user: User
) -> PlanningDocument:
    payload = apply_updates(document, data)
    if document.status == PlanningDocumentStatus.APPROVED and document.approved_at is None:
        document.approved_at = datetime.now(UTC)
    await record_event(
        db,
        matter_id=document.matter_id,
        case_id=document.case_id,
        event_type="planning_document",
        title=f"更新企劃書：{document.title}",
        actor=user,
        payload=payload,
    )
    await db.flush()
    return document


async def create_planning_revision(
    db: AsyncSession,
    *,
    document: PlanningDocument,
    data: PlanningDocumentRevisionCreate,
    user: User,
) -> PlanningDocumentRevision:
    version_number = document.current_version + 1
    revision = PlanningDocumentRevision(
        document_id=document.id,
        version_number=version_number,
        version_label=data.version_label,
        content=data.content,
        change_reason=data.change_reason,
        created_by_id=user.id,
    )
    document.current_version = version_number
    db.add(revision)
    await db.flush()
    await _set_revision_attachments(
        db,
        document=document,
        revision=revision,
        attachment_ids=data.attachment_ids,
        primary_attachment_id=data.primary_attachment_id,
    )
    await record_event(
        db,
        matter_id=document.matter_id,
        case_id=document.case_id,
        event_type="planning_document",
        title=f"新增企劃書版本：{document.title} v{version_number}",
        actor=user,
        payload={"planning_document_id": str(document.id), "revision_id": str(revision.id)},
    )
    return revision


async def _set_revision_attachments(
    db: AsyncSession,
    *,
    document: PlanningDocument,
    revision: PlanningDocumentRevision,
    attachment_ids: list[uuid.UUID],
    primary_attachment_id: uuid.UUID | None,
) -> None:
    unique_ids = list(dict.fromkeys(attachment_ids))
    if primary_attachment_id and primary_attachment_id not in unique_ids:
        raise ValueError("主要文件必須包含在此版本附件中")
    if not unique_ids:
        return
    rows = (
        (
            await db.execute(
                select(PlanningDocumentAttachment).where(
                    PlanningDocumentAttachment.document_id == document.id,
                    PlanningDocumentAttachment.id.in_(unique_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(rows) != len(unique_ids):
        raise ValueError("版本包含不屬於此企劃書的附件")
    attachments_by_id = {row.id: row for row in rows}
    for index, attachment_id in enumerate(unique_ids):
        db.add(
            PlanningDocumentRevisionAttachment(
                revision=revision,
                attachment=attachments_by_id[attachment_id],
                is_primary=attachment_id == primary_attachment_id,
                sort_order=index,
            )
        )
    await db.flush()


async def get_planning_attachment(
    db: AsyncSession, attachment_id: uuid.UUID
) -> PlanningDocumentAttachment | None:
    return await db.get(PlanningDocumentAttachment, attachment_id)


async def attachment_is_referenced(db: AsyncSession, attachment_id: uuid.UUID) -> bool:
    return (
        await db.scalar(
            select(PlanningDocumentRevisionAttachment.attachment_id)
            .where(PlanningDocumentRevisionAttachment.attachment_id == attachment_id)
            .limit(1)
        )
        is not None
    )


async def create_role_assignment(
    db: AsyncSession, *, matter: Matter, data: MatterRoleAssignmentCreate, user: User
) -> MatterRoleAssignment:
    assignment = MatterRoleAssignment(matter_id=matter.id, **data.model_dump())
    db.add(assignment)
    await db.flush()
    await record_event(
        db,
        matter_id=matter.id,
        event_type="role_assignment",
        title=f"新增職務：{assignment.role_name}",
        actor=user,
        payload={"role_assignment_id": str(assignment.id)},
    )
    return assignment


async def get_role_assignment(
    db: AsyncSession, assignment_id: uuid.UUID
) -> MatterRoleAssignment | None:
    return await db.get(MatterRoleAssignment, assignment_id)


async def update_role_assignment(
    db: AsyncSession,
    *,
    assignment: MatterRoleAssignment,
    data: MatterRoleAssignmentUpdate,
    user: User,
) -> MatterRoleAssignment:
    payload = apply_updates(assignment, data)
    await record_event(
        db,
        matter_id=assignment.matter_id,
        event_type="role_assignment",
        title=f"更新職務：{assignment.role_name}",
        actor=user,
        payload=payload,
    )
    await db.flush()
    return assignment


async def create_workflow_template(
    db: AsyncSession, *, data: GovernanceWorkflowTemplateCreate, user: User
) -> GovernanceWorkflowTemplate:
    template = GovernanceWorkflowTemplate(**data.model_dump(), created_by_id=user.id)
    db.add(template)
    await db.flush()
    return template


async def list_workflow_templates(db: AsyncSession) -> list[GovernanceWorkflowTemplate]:
    result = await db.execute(
        select(GovernanceWorkflowTemplate)
        .where(GovernanceWorkflowTemplate.is_active.is_(True))
        .order_by(GovernanceWorkflowTemplate.template_type, GovernanceWorkflowTemplate.name)
    )
    return list(result.scalars().all())


async def create_automation_rule(
    db: AsyncSession, *, data: AutomationRuleCreate, user: User
) -> AutomationRule:
    rule = AutomationRule(**data.model_dump(), created_by_id=user.id)
    db.add(rule)
    await db.flush()
    return rule


async def list_automation_rules(
    db: AsyncSession, *, matter_id: uuid.UUID | None = None
) -> list[AutomationRule]:
    stmt = select(AutomationRule).order_by(AutomationRule.updated_at.desc())
    if matter_id:
        stmt = stmt.where(
            or_(AutomationRule.matter_id == matter_id, AutomationRule.matter_id.is_(None))
        )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_automation_rule(db: AsyncSession, rule_id: uuid.UUID) -> AutomationRule | None:
    return await db.get(AutomationRule, rule_id)


async def update_automation_rule(
    db: AsyncSession, *, rule: AutomationRule, data: AutomationRuleUpdate, user: User
) -> AutomationRule:
    apply_updates(rule, data)
    await db.flush()
    return rule


async def dashboard(db: AsyncSession, *, user: User) -> dict:
    now = datetime.now(UTC)
    active_matters = await db.scalar(
        select(func.count(Matter.id)).where(
            Matter.is_active.is_(True),
            Matter.status.in_([MatterStatus.ACTIVE, MatterStatus.PAUSED]),
        )
    )
    overdue_matters = await db.scalar(
        select(func.count(Matter.id)).where(
            Matter.is_active.is_(True),
            Matter.due_at.is_not(None),
            Matter.due_at < now,
            Matter.status.in_([MatterStatus.ACTIVE, MatterStatus.PAUSED]),
        )
    )
    open_cases = await db.scalar(
        select(func.count(GovernanceCase.id)).where(
            GovernanceCase.is_active.is_(True),
            GovernanceCase.status.in_([CaseStatus.TODO, CaseStatus.IN_PROGRESS, CaseStatus.REVIEW]),
        )
    )
    open_tasks = await db.scalar(
        select(func.count(WorkItem.id)).where(
            WorkItem.is_active.is_(True),
            WorkItem.status == WorkItemStatus.OPEN,
            WorkItem.source_type == "matter",
        )
    )
    my_tasks = await db.scalar(
        select(func.count(WorkItem.id)).where(
            WorkItem.is_active.is_(True),
            WorkItem.status == WorkItemStatus.OPEN,
            WorkItem.assigned_to_id == user.id,
        )
    )
    pending_decisions = await db.scalar(
        select(func.count(Decision.id)).where(
            Decision.status.in_(
                [DecisionStatus.PENDING, DecisionStatus.IN_PROGRESS, DecisionStatus.PARTIAL]
            )
        )
    )
    plans_in_review = await db.scalar(
        select(func.count(PlanningDocument.id)).where(
            PlanningDocument.is_active.is_(True),
            PlanningDocument.status.in_(
                [PlanningDocumentStatus.SUBMITTED, PlanningDocumentStatus.IN_REVIEW]
            ),
        )
    )
    matters = await list_matters(db, user=user, limit=12)
    return {
        "stats": {
            "active_matters": int(active_matters or 0),
            "overdue_matters": int(overdue_matters or 0),
            "open_cases": int(open_cases or 0),
            "open_tasks": int(open_tasks or 0),
            "my_tasks": int(my_tasks or 0),
            "pending_decisions": int(pending_decisions or 0),
            "plans_in_review": int(plans_in_review or 0),
        },
        "matters": matters,
    }
