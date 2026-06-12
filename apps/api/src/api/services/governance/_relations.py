"""實體關聯 / 跨模組圖譜"""

from __future__ import annotations

import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.governance import EntityRelation, GovernanceEventType, Matter
from api.models.user import User
from api.schemas.governance import EntityRelationCreate
from api.services.governance._events import record_event


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
