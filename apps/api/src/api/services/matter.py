"""Root Matter integration service."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.governance import (
    EntityRelation,
    GovernanceEventType,
    Matter,
    MatterResource,
    TimelineEvent,
)
from api.models.user import User
from api.schemas.governance import (
    EntityRelationCreate,
    MatterCreate,
    MatterResourceCreate,
    MatterResourceUpdate,
    MatterUpdate,
)
from api.services import governance as governance_svc
from api.services._base import apply_updates
from api.services.governance._events import record_event


async def list_matters(
    db: AsyncSession,
    *,
    user: User,
    status: str | None = None,
    matter_type: str | None = None,
    q: str | None = None,
    limit: int = 80,
    offset: int = 0,
):
    return await governance_svc.list_matters(
        db,
        user=user,
        status=status,
        matter_type=matter_type,
        q=q,
        limit=limit,
        offset=offset,
    )


async def get_matter(db: AsyncSession, matter_id: uuid.UUID) -> Matter | None:
    return await governance_svc.get_matter(db, matter_id)


async def create_matter(db: AsyncSession, *, data: MatterCreate, user: User) -> Matter:
    return await governance_svc.create_matter(db, data=data, user=user)


async def update_matter(
    db: AsyncSession, *, matter: Matter, data: MatterUpdate, user: User
) -> Matter:
    return await governance_svc.update_matter(db, matter=matter, data=data, user=user)


async def list_timeline(db: AsyncSession, matter_id: uuid.UUID) -> list[TimelineEvent]:
    rows = await db.execute(
        select(TimelineEvent)
        .where(TimelineEvent.matter_id == matter_id)
        .order_by(TimelineEvent.created_at.asc())
    )
    return list(rows.scalars().all())


async def create_relation(
    db: AsyncSession, *, matter: Matter, data: EntityRelationCreate, user: User
) -> EntityRelation:
    return await governance_svc.create_relation(db, matter=matter, data=data, user=user)


async def get_relation(db: AsyncSession, relation_id: uuid.UUID) -> EntityRelation | None:
    return await governance_svc.get_relation(db, relation_id)


async def delete_relation(db: AsyncSession, *, relation: EntityRelation, user: User) -> None:
    await governance_svc.delete_relation(db, relation=relation, user=user)


async def list_resources(db: AsyncSession, matter_id: uuid.UUID) -> list[MatterResource]:
    rows = await db.execute(
        select(MatterResource)
        .where(MatterResource.matter_id == matter_id, MatterResource.is_active.is_(True))
        .order_by(MatterResource.created_at.asc())
    )
    return list(rows.scalars().all())


async def create_resource(
    db: AsyncSession,
    *,
    matter: Matter,
    data: MatterResourceCreate,
    user: User,
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
        title=f"新增資源：{resource.title}",
        actor=user,
        payload={
            "resource_id": str(resource.id),
            "resource_type": resource.resource_type,
            "url": resource.url,
        },
    )
    await db.refresh(resource)
    return resource


async def get_resource(db: AsyncSession, resource_id: uuid.UUID) -> MatterResource | None:
    return await db.get(MatterResource, resource_id)


async def update_resource(
    db: AsyncSession,
    *,
    resource: MatterResource,
    data: MatterResourceUpdate,
    user: User,
) -> MatterResource:
    payload = apply_updates(resource, data)
    if payload:
        await record_event(
            db,
            matter_id=resource.matter_id,
            event_type=GovernanceEventType.UPDATED,
            title=f"更新資源：{resource.title}",
            actor=user,
            payload={"resource_id": str(resource.id), "changes": payload},
        )
    await db.flush()
    await db.refresh(resource)
    return resource


async def delete_resource(db: AsyncSession, *, resource: MatterResource, user: User) -> None:
    title = resource.title
    matter_id = resource.matter_id
    resource.is_active = False
    await record_event(
        db,
        matter_id=matter_id,
        event_type=GovernanceEventType.UPDATED,
        title=f"移除資源：{title}",
        actor=user,
        payload={"resource_id": str(resource.id)},
    )
    await db.flush()
