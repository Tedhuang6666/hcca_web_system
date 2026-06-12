"""事情導向治理中樞 service。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.governance import (
    AutomationRule,
    CaseStatus,
    Decision,
    DecisionStatus,
    EntityRelation,
    GovernanceCase,
    GovernanceEventType,
    GovernanceWorkflowTemplate,
    Matter,
    MatterRoleAssignment,
    MatterStatus,
    PlanningDocument,
    PlanningDocumentAttachment,
    PlanningDocumentRevision,
    PlanningDocumentRevisionAttachment,
    PlanningDocumentStatus,
    Program,
    TimelineEvent,
)
from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus
from api.schemas.governance import (
    AutomationRuleCreate,
    AutomationRuleUpdate,
    DecisionCreate,
    DecisionUpdate,
    EntityRelationCreate,
    GovernanceCaseCreate,
    GovernanceCaseUpdate,
    GovernanceWorkflowTemplateCreate,
    MatterCreate,
    MatterListItem,
    MatterRoleAssignmentCreate,
    MatterRoleAssignmentUpdate,
    MatterUpdate,
    PlanningDocumentCreate,
    PlanningDocumentRevisionCreate,
    PlanningDocumentUpdate,
    ProgramCreate,
    ProgramUpdate,
    TimelineEventCreate,
)
from api.schemas.work_item import WorkItemCreate
from api.services import work_item as work_item_svc


def _apply_visibility(stmt: Select[tuple[Matter]], user: User) -> Select[tuple[Matter]]:
    if user.is_superuser:
        return stmt
    return stmt.where(
        or_(
            Matter.visibility.in_(["internal", "public"]),
            Matter.owner_user_id == user.id,
            Matter.created_by_id == user.id,
        )
    )


async def list_matters(
    db: AsyncSession,
    *,
    user: User,
    status: str | None = None,
    matter_type: str | None = None,
    q: str | None = None,
    limit: int = 80,
    offset: int = 0,
) -> list[MatterListItem]:
    case_counts = (
        select(GovernanceCase.matter_id, func.count(GovernanceCase.id).label("case_count"))
        .where(GovernanceCase.is_active.is_(True))
        .group_by(GovernanceCase.matter_id)
        .subquery()
    )
    task_counts = (
        select(WorkItem.source_id.label("matter_id"), func.count(WorkItem.id).label("task_count"))
        .where(
            WorkItem.source_type == "matter",
            WorkItem.status == WorkItemStatus.OPEN,
            WorkItem.is_active.is_(True),
        )
        .group_by(WorkItem.source_id)
        .subquery()
    )
    link_counts = (
        select(EntityRelation.matter_id, func.count(EntityRelation.id).label("link_count"))
        .group_by(EntityRelation.matter_id)
        .subquery()
    )
    stmt = (
        select(
            Matter,
            func.coalesce(case_counts.c.case_count, 0),
            func.coalesce(task_counts.c.task_count, 0),
            func.coalesce(link_counts.c.link_count, 0),
        )
        .outerjoin(case_counts, case_counts.c.matter_id == Matter.id)
        .outerjoin(task_counts, task_counts.c.matter_id == Matter.id)
        .outerjoin(link_counts, link_counts.c.matter_id == Matter.id)
        .where(Matter.is_active.is_(True))
        .order_by(Matter.updated_at.desc(), Matter.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if status:
        stmt = stmt.where(Matter.status == status)
    if matter_type:
        stmt = stmt.where(Matter.matter_type == matter_type)
    if q:
        stmt = stmt.where(Matter.title.ilike(f"%{q}%"))
    stmt = _apply_visibility(stmt, user)
    rows = (await db.execute(stmt)).all()
    items: list[MatterListItem] = []
    for matter, case_count, task_count, link_count in rows:
        item = MatterListItem.model_validate(matter)
        item.case_count = int(case_count)
        item.open_task_count = int(task_count)
        item.link_count = int(link_count)
        items.append(item)
    return items


async def get_matter(db: AsyncSession, matter_id: uuid.UUID) -> Matter | None:
    result = await db.execute(
        select(Matter)
        .options(
            selectinload(Matter.programs),
            selectinload(Matter.cases),
            selectinload(Matter.links),
            selectinload(Matter.events),
            selectinload(Matter.decisions),
            selectinload(Matter.planning_documents).selectinload(PlanningDocument.attachments),
            selectinload(Matter.planning_documents)
            .selectinload(PlanningDocument.revisions)
            .selectinload(PlanningDocumentRevision.attachment_links)
            .selectinload(PlanningDocumentRevisionAttachment.attachment),
            selectinload(Matter.role_assignments),
        )
        .where(Matter.id == matter_id, Matter.is_active.is_(True))
    )
    return result.scalar_one_or_none()


async def create_matter(db: AsyncSession, *, data: MatterCreate, user: User) -> Matter:
    matter = Matter(**data.model_dump(), created_by_id=user.id)
    db.add(matter)
    await db.flush()
    await record_event(
        db,
        matter_id=matter.id,
        event_type=GovernanceEventType.CREATED,
        title=f"建立事情：{matter.title}",
        actor=user,
    )
    return matter


async def update_matter(
    db: AsyncSession, *, matter: Matter, data: MatterUpdate, user: User
) -> Matter:
    before_status = matter.status
    payload = data.model_dump(exclude_unset=True)
    for key, value in payload.items():
        setattr(matter, key, value)
    if "status" in payload and matter.status != before_status:
        await record_event(
            db,
            matter_id=matter.id,
            event_type=GovernanceEventType.STATUS_CHANGED,
            title=f"狀態變更：{before_status} → {matter.status}",
            actor=user,
            payload={"from_status": before_status, "to_status": matter.status},
        )
    else:
        await record_event(
            db,
            matter_id=matter.id,
            event_type=GovernanceEventType.UPDATED,
            title=f"更新事情：{matter.title}",
            actor=user,
            payload=payload,
        )
    await db.flush()
    return matter


async def create_program(
    db: AsyncSession, *, matter: Matter, data: ProgramCreate, user: User
) -> Program:
    program = Program(matter_id=matter.id, **data.model_dump())
    db.add(program)
    await db.flush()
    await record_event(
        db,
        matter_id=matter.id,
        event_type=GovernanceEventType.CREATED,
        title=f"新增專案：{program.name}",
        actor=user,
        payload={"program_id": str(program.id)},
    )
    return program


async def update_program(
    db: AsyncSession, *, program: Program, data: ProgramUpdate, user: User
) -> Program:
    payload = data.model_dump(exclude_unset=True)
    for key, value in payload.items():
        setattr(program, key, value)
    await record_event(
        db,
        matter_id=program.matter_id,
        event_type=GovernanceEventType.UPDATED,
        title=f"更新專案：{program.name}",
        actor=user,
        payload=payload,
    )
    await db.flush()
    return program


async def get_program(db: AsyncSession, program_id: uuid.UUID) -> Program | None:
    return await db.get(Program, program_id)


async def create_case(
    db: AsyncSession, *, matter: Matter, data: GovernanceCaseCreate, user: User
) -> GovernanceCase:
    case = GovernanceCase(matter_id=matter.id, **data.model_dump())
    db.add(case)
    await db.flush()
    await record_event(
        db,
        matter_id=matter.id,
        case_id=case.id,
        event_type=GovernanceEventType.CREATED,
        title=f"新增案件：{case.title}",
        actor=user,
    )
    return case


async def get_case(db: AsyncSession, case_id: uuid.UUID) -> GovernanceCase | None:
    return await db.get(GovernanceCase, case_id)


async def update_case(
    db: AsyncSession, *, case: GovernanceCase, data: GovernanceCaseUpdate, user: User
) -> GovernanceCase:
    before_status = case.status
    payload = data.model_dump(exclude_unset=True)
    for key, value in payload.items():
        setattr(case, key, value)
    if case.status in {CaseStatus.DONE, CaseStatus.ARCHIVED} and case.completed_at is None:
        case.completed_at = datetime.now(UTC)
    if "status" in payload and case.status != before_status:
        title = f"案件狀態變更：{case.title}（{before_status} → {case.status}）"
        event_type = GovernanceEventType.STATUS_CHANGED
    else:
        title = f"更新案件：{case.title}"
        event_type = GovernanceEventType.UPDATED
    await record_event(
        db,
        matter_id=case.matter_id,
        case_id=case.id,
        event_type=event_type,
        title=title,
        actor=user,
        payload=payload,
    )
    await db.flush()
    return case


async def create_relation(
    db: AsyncSession, *, matter: Matter, data: EntityRelationCreate, user: User
) -> EntityRelation:
    payload = data.model_dump()
    payload["matter_id"] = matter.id
    if payload["source_id"] is None and payload["source_type"] == "matter":
        payload["source_id"] = matter.id
    relation = EntityRelation(**payload, created_by_id=user.id)
    db.add(relation)
    await db.flush()
    await record_event(
        db,
        matter_id=matter.id,
        case_id=relation.case_id,
        event_type=GovernanceEventType.LINKED,
        title=f"新增關聯：{relation.title}",
        actor=user,
        payload={
            "relation_id": str(relation.id),
            "target_type": relation.target_type,
            "target_id": str(relation.target_id) if relation.target_id else None,
        },
    )
    return relation


async def create_entity_relation(
    db: AsyncSession,
    *,
    source_type: str,
    source_id: uuid.UUID,
    data: EntityRelationCreate,
    user: User,
) -> EntityRelation:
    existing = await db.scalar(
        select(EntityRelation).where(
            EntityRelation.source_type == source_type,
            EntityRelation.source_id == source_id,
            EntityRelation.target_type == data.target_type,
            EntityRelation.target_id == data.target_id,
            EntityRelation.relation == data.relation,
        )
    )
    if existing is not None:
        return existing
    relation = EntityRelation(
        **data.model_dump(exclude={"source_type", "source_id"}),
        source_type=source_type,
        source_id=source_id,
        created_by_id=user.id,
    )
    db.add(relation)
    await db.flush()
    return relation


async def list_entity_relations(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
) -> list[EntityRelation]:
    rows = await db.execute(
        select(EntityRelation)
        .where(
            or_(
                and_(
                    EntityRelation.source_type == entity_type,
                    EntityRelation.source_id == entity_id,
                ),
                and_(
                    EntityRelation.target_type == entity_type,
                    EntityRelation.target_id == entity_id,
                ),
            )
        )
        .order_by(EntityRelation.updated_at.desc())
    )
    return list(rows.scalars().all())


async def entity_relation_graph(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    depth: int,
) -> tuple[list[dict], list[EntityRelation]]:
    frontier = {(entity_type, entity_id)}
    visited = set(frontier)
    edges: dict[uuid.UUID, EntityRelation] = {}
    for _ in range(depth):
        if not frontier:
            break
        clauses = []
        for node_type, node_id in frontier:
            clauses.extend(
                [
                    and_(
                        EntityRelation.source_type == node_type,
                        EntityRelation.source_id == node_id,
                    ),
                    and_(
                        EntityRelation.target_type == node_type,
                        EntityRelation.target_id == node_id,
                    ),
                ]
            )
        rows = list((await db.execute(select(EntityRelation).where(or_(*clauses)))).scalars().all())
        next_frontier: set[tuple[str, uuid.UUID]] = set()
        for edge in rows:
            edges[edge.id] = edge
            for node_type, node_id in (
                (edge.source_type, edge.source_id),
                (edge.target_type, edge.target_id),
            ):
                if node_id is not None and (node_type, node_id) not in visited:
                    visited.add((node_type, node_id))
                    next_frontier.add((node_type, node_id))
        frontier = next_frontier
    nodes = [{"type": node_type, "id": node_id} for node_type, node_id in visited]
    return nodes, list(edges.values())


async def list_relations_for_target(
    db: AsyncSession, *, target_type: str, target_id: uuid.UUID
) -> list[tuple[EntityRelation, Matter]]:
    """反向查詢：某模組資源被哪些事情納入（供詳情頁顯示「屬於哪件事情」）。"""
    rows = await db.execute(
        select(EntityRelation, Matter)
        .join(Matter, EntityRelation.matter_id == Matter.id)
        .where(
            EntityRelation.target_type == target_type,
            EntityRelation.target_id == target_id,
            Matter.is_active.is_(True),
        )
        .order_by(Matter.updated_at.desc())
    )
    return [(relation, matter) for relation, matter in rows.all()]


async def get_relation(db: AsyncSession, relation_id: uuid.UUID) -> EntityRelation | None:
    return await db.get(EntityRelation, relation_id)


async def delete_relation(db: AsyncSession, *, relation: EntityRelation, user: User) -> None:
    matter_id = relation.matter_id
    title = relation.title
    await db.delete(relation)
    await db.flush()
    if matter_id is not None:
        await record_event(
            db,
            matter_id=matter_id,
            event_type=GovernanceEventType.UPDATED,
            title=f"移除關聯：{title}",
            actor=user,
        )


async def record_event(
    db: AsyncSession,
    *,
    matter_id: uuid.UUID | None,
    event_type: str,
    title: str,
    actor: User | None = None,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    case_id: uuid.UUID | None = None,
    body: str | None = None,
    payload: dict | None = None,
) -> TimelineEvent:
    # actor（User 物件）優先；audit 橋接只有 id/email 字串時走 actor_id/actor_email。
    resolved_actor_id = actor.id if actor else actor_id
    resolved_actor_email = actor.email if actor else actor_email
    event = TimelineEvent(
        matter_id=matter_id,
        case_id=case_id,
        event_type=str(event_type),
        title=title,
        body=body,
        actor_id=resolved_actor_id,
        actor_email=resolved_actor_email,
        payload=payload or {},
        created_at=datetime.now(UTC),
    )
    db.add(event)
    await db.flush()
    return event


async def create_timeline_event(
    db: AsyncSession, *, matter: Matter, data: TimelineEventCreate, user: User
) -> TimelineEvent:
    return await record_event(
        db,
        matter_id=matter.id,
        case_id=data.case_id,
        event_type=data.event_type,
        title=data.title,
        body=data.body,
        actor=user,
        payload=data.payload,
    )


async def create_matter_task(
    db: AsyncSession, *, matter: Matter, data: WorkItemCreate, user: User
) -> WorkItem:
    payload = data.model_copy(update={"source_type": "matter", "source_id": matter.id})
    item = await work_item_svc.create_work_item(db, data=payload, created_by_id=user.id)
    await record_event(
        db,
        matter_id=matter.id,
        event_type=GovernanceEventType.TASK_CREATED,
        title=f"新增任務：{item.title}",
        actor=user,
        payload={"work_item_id": str(item.id)},
    )
    return item


async def create_decision(
    db: AsyncSession, *, matter: Matter, data: DecisionCreate, user: User
) -> Decision:
    decision = Decision(matter_id=matter.id, **data.model_dump(), created_by_id=user.id)
    db.add(decision)
    await db.flush()
    await record_event(
        db,
        matter_id=matter.id,
        case_id=decision.case_id,
        event_type="decision",
        title=f"新增決議：{decision.title}",
        actor=user,
        payload={"decision_id": str(decision.id)},
    )
    return decision


async def get_decision(db: AsyncSession, decision_id: uuid.UUID) -> Decision | None:
    return await db.get(Decision, decision_id)


async def update_decision(
    db: AsyncSession, *, decision: Decision, data: DecisionUpdate, user: User
) -> Decision:
    previous = decision.status
    payload = data.model_dump(exclude_unset=True)
    for key, value in payload.items():
        setattr(decision, key, value)
    if decision.status == DecisionStatus.COMPLETED and decision.completed_at is None:
        decision.completed_at = datetime.now(UTC)
    if decision.status != DecisionStatus.COMPLETED:
        decision.completed_at = None
    await record_event(
        db,
        matter_id=decision.matter_id,
        case_id=decision.case_id,
        event_type="decision",
        title=f"更新決議：{decision.title}",
        actor=user,
        payload={**payload, "from_status": previous, "to_status": decision.status},
    )
    await db.flush()
    return decision


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
    payload = data.model_dump(exclude_unset=True)
    for key, value in payload.items():
        setattr(document, key, value)
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
    payload = data.model_dump(exclude_unset=True)
    for key, value in payload.items():
        setattr(assignment, key, value)
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
    payload = data.model_dump(exclude_unset=True)
    for key, value in payload.items():
        setattr(rule, key, value)
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
