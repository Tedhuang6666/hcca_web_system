"""議會提案服務層。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.council_proposal import CouncilProposal, CouncilProposalStatus
from api.models.user import User
from api.schemas.council_proposal import CouncilProposalCreate, CouncilProposalStatusUpdate


async def _next_serial_number(session: AsyncSession) -> str:
    year = datetime.now(UTC).year - 1911
    prefix = f"議提{year:03d}"
    result = await session.execute(
        select(CouncilProposal.serial_number)
        .where(CouncilProposal.serial_number.like(f"{prefix}%"))
        .order_by(CouncilProposal.serial_number.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    next_counter = int(latest[-4:]) + 1 if latest else 1
    return f"{prefix}{next_counter:04d}"


async def create(
    session: AsyncSession,
    *,
    data: CouncilProposalCreate,
    submitter: User | None,
) -> CouncilProposal:
    proposal = CouncilProposal(
        serial_number=await _next_serial_number(session),
        submitter_id=submitter.id if submitter else None,
        **data.model_dump(),
    )
    session.add(proposal)
    await session.flush()
    return proposal


async def list_items(
    session: AsyncSession,
    *,
    submitter_id: uuid.UUID | None = None,
    status: CouncilProposalStatus | None = None,
    limit: int = 80,
    offset: int = 0,
) -> list[CouncilProposal]:
    stmt = (
        select(CouncilProposal)
        .order_by(CouncilProposal.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if submitter_id:
        stmt = stmt.where(CouncilProposal.submitter_id == submitter_id)
    if status:
        stmt = stmt.where(CouncilProposal.status == status)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get(session: AsyncSession, proposal_id: uuid.UUID) -> CouncilProposal | None:
    return await session.get(CouncilProposal, proposal_id)


async def update_status(
    session: AsyncSession,
    proposal: CouncilProposal,
    *,
    data: CouncilProposalStatusUpdate,
) -> CouncilProposal:
    proposal.status = data.status
    if data.committee_review_note is not None:
        proposal.committee_review_note = data.committee_review_note
    if data.scheduled_meeting_id is not None:
        proposal.scheduled_meeting_id = data.scheduled_meeting_id
    now = datetime.now(UTC)
    if data.status == CouncilProposalStatus.SCHEDULED:
        proposal.scheduled_at = proposal.scheduled_at or now
    if data.status in {
        CouncilProposalStatus.PASSED,
        CouncilProposalStatus.REJECTED,
        CouncilProposalStatus.WITHDRAWN,
    }:
        proposal.decided_at = proposal.decided_at or now
    await session.flush()
    return proposal
