"""時間軸事件 / 任務 / 決議"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.governance import (
    Decision,
    DecisionStatus,
    GovernanceEventType,
    TimelineEvent,
)
from api.models.user import User
from api.models.work_item import WorkItem
from api.schemas.governance import DecisionCreate, DecisionUpdate, TimelineEventCreate
from api.schemas.work_item import WorkItemCreate
from api.services import work_item as work_item_svc
from api.services._base import apply_updates


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
        payload=json.loads(json.dumps(payload or {}, default=str)),
        created_at=datetime.now(UTC),
    )
    db.add(event)
    await db.flush()
    return event


async def create_timeline_event(
    db: AsyncSession, *, matter, data: TimelineEventCreate, user: User
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
    db: AsyncSession, *, matter, data: WorkItemCreate, user: User
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
    db: AsyncSession, *, matter, data: DecisionCreate, user: User
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
    payload = apply_updates(decision, data)
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
