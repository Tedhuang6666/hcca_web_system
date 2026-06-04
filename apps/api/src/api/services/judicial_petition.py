"""評議委員會訴訟服務層。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import roc_year
from api.core.database import advisory_xact_lock
from api.models.judicial_petition import JudicialPetition, JudicialPetitionStatus
from api.models.user import User
from api.schemas.judicial_petition import JudicialPetitionCreate, JudicialPetitionStatusUpdate
from api.services import workflow as workflow_svc

# advisory lock key（任取穩定常數，與其他臨界區不同即可）
_DOCKET_LOCK_KEY = 0x6A70_6574  # "jpet"


async def _next_docket_number(session: AsyncSession) -> str:
    year = roc_year()
    prefix = f"評訴{year:03d}"
    await advisory_xact_lock(session, _DOCKET_LOCK_KEY)
    result = await session.execute(
        select(JudicialPetition.docket_number)
        .where(JudicialPetition.docket_number.like(f"{prefix}%"))
        .order_by(JudicialPetition.docket_number.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    next_counter = int(latest[-4:]) + 1 if latest else 1
    return f"{prefix}{next_counter:04d}"


async def create(
    session: AsyncSession,
    *,
    data: JudicialPetitionCreate,
    submitter: User | None,
) -> JudicialPetition:
    petition = JudicialPetition(
        docket_number=await _next_docket_number(session),
        submitter_id=submitter.id if submitter else None,
        **data.model_dump(),
    )
    session.add(petition)
    await session.flush()
    await workflow_svc.ensure_instance(
        session,
        workflow_type="judicial_petition",
        source_type="judicial_petition",
        source_id=petition.id,
        title=petition.title,
        status=str(petition.status),
        created_by_id=submitter.id if submitter else None,
        actor_email=submitter.email if submitter else None,
        meta={
            "docket_number": petition.docket_number,
            "petition_type": str(petition.petition_type),
            "summary": petition.petition_claim,
        },
    )
    return petition


async def list_items(
    session: AsyncSession,
    *,
    submitter_id: uuid.UUID | None = None,
    status: JudicialPetitionStatus | None = None,
    limit: int = 80,
    offset: int = 0,
) -> list[JudicialPetition]:
    stmt = (
        select(JudicialPetition)
        .order_by(JudicialPetition.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if submitter_id:
        stmt = stmt.where(JudicialPetition.submitter_id == submitter_id)
    if status:
        stmt = stmt.where(JudicialPetition.status == status)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get(session: AsyncSession, petition_id: uuid.UUID) -> JudicialPetition | None:
    return await session.get(JudicialPetition, petition_id)


async def update_status(
    session: AsyncSession,
    petition: JudicialPetition,
    *,
    data: JudicialPetitionStatusUpdate,
    actor: User | None = None,
) -> JudicialPetition:
    petition.status = data.status
    if data.docketing_note is not None:
        petition.docketing_note = data.docketing_note
    if data.decision_summary is not None:
        petition.decision_summary = data.decision_summary
    if data.status in {
        JudicialPetitionStatus.DECIDED,
        JudicialPetitionStatus.DISMISSED,
        JudicialPetitionStatus.PUBLISHED,
    }:
        petition.decided_at = petition.decided_at or datetime.now(UTC)
    await workflow_svc.transition_by_source(
        session,
        source_type="judicial_petition",
        source_id=petition.id,
        status=str(data.status),
        title=petition.title,
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        note=data.docketing_note,
        payload={"decision_summary": data.decision_summary},
    )
    await session.flush()
    return petition
