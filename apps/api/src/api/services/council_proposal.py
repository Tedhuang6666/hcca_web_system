"""議會提案服務層。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import roc_year
from api.core.database import advisory_xact_lock
from api.models.council_proposal import (
    CouncilProposal,
    CouncilProposalCaseType,
    CouncilProposalStatus,
)
from api.models.user import User
from api.schemas.council_proposal import CouncilProposalCreate, CouncilProposalStatusUpdate
from api.services import workflow as workflow_svc

# advisory lock key（任取穩定常數，與其他臨界區不同即可）
_SERIAL_LOCK_KEY = 0x6363_7072  # "ccpr"


async def _next_serial_number(session: AsyncSession) -> str:
    year = roc_year()
    prefix = f"議提{year:03d}"
    await advisory_xact_lock(session, _SERIAL_LOCK_KEY)
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
    await workflow_svc.ensure_instance(
        session,
        workflow_type="council_proposal",
        source_type="council_proposal",
        source_id=proposal.id,
        title=proposal.title,
        status=str(proposal.status),
        created_by_id=submitter.id if submitter else None,
        actor_email=submitter.email if submitter else None,
        meta={
            "serial_number": proposal.serial_number,
            "case_type": str(proposal.case_type),
            "summary": proposal.summary,
        },
    )
    # 重新載入以 eager-load regulation，供序列化 regulation_title 使用。
    return await get(session, proposal.id) or proposal


async def list_items(
    session: AsyncSession,
    *,
    submitter_id: uuid.UUID | None = None,
    status: CouncilProposalStatus | None = None,
    case_type: CouncilProposalCaseType | None = None,
    limit: int = 80,
    offset: int = 0,
) -> list[CouncilProposal]:
    stmt = (
        select(CouncilProposal)
        .options(selectinload(CouncilProposal.regulation))
        .order_by(CouncilProposal.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if submitter_id:
        stmt = stmt.where(CouncilProposal.submitter_id == submitter_id)
    if status:
        stmt = stmt.where(CouncilProposal.status == status)
    if case_type:
        stmt = stmt.where(CouncilProposal.case_type == case_type)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get(session: AsyncSession, proposal_id: uuid.UUID) -> CouncilProposal | None:
    stmt = (
        select(CouncilProposal)
        .options(selectinload(CouncilProposal.regulation))
        .where(CouncilProposal.id == proposal_id)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def update_status(
    session: AsyncSession,
    proposal: CouncilProposal,
    *,
    data: CouncilProposalStatusUpdate,
    actor: User | None = None,
) -> CouncilProposal:
    proposal.status = data.status
    if data.committee_review_note is not None:
        proposal.committee_review_note = data.committee_review_note
    now = datetime.now(UTC)
    if data.status in {
        CouncilProposalStatus.PASSED,
        CouncilProposalStatus.REJECTED,
        CouncilProposalStatus.WITHDRAWN,
        CouncilProposalStatus.PUBLISHED,
    }:
        proposal.decided_at = proposal.decided_at or now
    await workflow_svc.transition_by_source(
        session,
        source_type="council_proposal",
        source_id=proposal.id,
        status=str(data.status),
        title=proposal.title,
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        note=data.committee_review_note,
        payload={},
    )
    await session.flush()
    return proposal
