"""事情 / 專案 / 案件 CRUD"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.governance import (
    CaseStatus,
    EntityRelation,
    GovernanceCase,
    GovernanceDiscordWorkspace,
    GovernanceEventType,
    Matter,
    MatterResource,
    PlanningDocument,
    PlanningDocumentRevision,
    PlanningDocumentRevisionAttachment,
    Program,
)
from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus
from api.schemas.governance import (
    GovernanceCaseCreate,
    GovernanceCaseUpdate,
    MatterCreate,
    MatterListItem,
    MatterResourceCreate,
    MatterResourceUpdate,
    MatterUpdate,
    ProgramCreate,
    ProgramUpdate,
)
from api.services._base import apply_updates
from api.services.governance._events import record_event


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
            selectinload(Matter.resources),
            selectinload(Matter.decisions),
            selectinload(Matter.planning_documents).selectinload(PlanningDocument.attachments),
            selectinload(Matter.planning_documents)
            .selectinload(PlanningDocument.revisions)
            .selectinload(PlanningDocumentRevision.attachment_links)
            .selectinload(PlanningDocumentRevisionAttachment.attachment),
            selectinload(Matter.role_assignments),
            selectinload(Matter.discord_workspace).selectinload(GovernanceDiscordWorkspace.routes),
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
    payload = apply_updates(matter, data)
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


async def create_matter_resource(
    db: AsyncSession, *, matter: Matter, data: MatterResourceCreate, user: User
) -> MatterResource:
    resource = MatterResource(
        matter_id=matter.id,
        created_by_id=user.id,
        **data.model_dump(),
    )
    db.add(resource)
    await db.flush()
    await record_event(
        db,
        matter_id=matter.id,
        event_type=GovernanceEventType.LINKED,
        title=f"新增協作資源：{resource.title}",
        actor=user,
        payload={"resource_id": str(resource.id), "resource_type": resource.resource_type},
    )
    return resource


async def get_matter_resource(db: AsyncSession, resource_id: uuid.UUID) -> MatterResource | None:
    return await db.get(MatterResource, resource_id)


async def update_matter_resource(
    db: AsyncSession, *, resource: MatterResource, data: MatterResourceUpdate, user: User
) -> MatterResource:
    payload = apply_updates(resource, data)
    await record_event(
        db,
        matter_id=resource.matter_id,
        event_type=GovernanceEventType.UPDATED,
        title=f"更新協作資源：{resource.title}",
        actor=user,
        payload=payload,
    )
    await db.flush()
    return resource


async def delete_matter_resource(
    db: AsyncSession, *, resource: MatterResource, user: User
) -> MatterResource:
    resource.is_active = False
    await record_event(
        db,
        matter_id=resource.matter_id,
        event_type=GovernanceEventType.UPDATED,
        title=f"停用協作資源：{resource.title}",
        actor=user,
        payload={"resource_id": str(resource.id), "is_active": False},
    )
    await db.flush()
    return resource


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
    payload = apply_updates(program, data)
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
    payload = apply_updates(case, data)
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
