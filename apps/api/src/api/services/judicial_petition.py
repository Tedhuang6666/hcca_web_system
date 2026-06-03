"""評議委員會訴訟服務層。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.judicial_petition import JudicialPetition, JudicialPetitionStatus
from api.models.user import User
from api.schemas.judicial_petition import JudicialPetitionCreate, JudicialPetitionStatusUpdate


async def _next_docket_number(session: AsyncSession) -> str:
    year = datetime.now(UTC).year - 1911
    prefix = f"評訴{year:03d}"
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
) -> JudicialPetition:
    petition.status = data.status
    if data.docketing_note is not None:
        petition.docketing_note = data.docketing_note
    if data.decision_summary is not None:
        petition.decision_summary = data.decision_summary
    if data.status in {JudicialPetitionStatus.DECIDED, JudicialPetitionStatus.DISMISSED}:
        petition.decided_at = petition.decided_at or datetime.now(UTC)
    await session.flush()
    return petition
