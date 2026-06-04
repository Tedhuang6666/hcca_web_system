"""議會提案服務層。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.council_proposal import (
    CouncilProposal,
    CouncilProposalCaseType,
    CouncilProposalStatus,
)
from api.models.meeting import Meeting, MeetingAgendaItem, MeetingStatus
from api.models.user import User
from api.schemas.council_proposal import CouncilProposalCreate, CouncilProposalStatusUpdate

# 議程仍可編輯（可帶入提案）的會議狀態
_SCHEDULABLE_MEETING_STATUSES = {MeetingStatus.DRAFT, MeetingStatus.CONFIRMED}


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


async def list_eligible_meetings(
    session: AsyncSession, proposal: CouncilProposal
) -> list[dict]:
    """列出可把提案排入議程的會議（議程仍可編輯者），標記是否已排入。"""
    stmt = (
        select(Meeting)
        .where(Meeting.status.in_(_SCHEDULABLE_MEETING_STATUSES))
        .order_by(Meeting.starts_at.desc().nullslast(), Meeting.created_at.desc())
    )
    meetings = list((await session.execute(stmt)).scalars().all())
    linked_meeting_ids = set(
        (
            await session.execute(
                select(MeetingAgendaItem.meeting_id).where(
                    MeetingAgendaItem.council_proposal_id == proposal.id
                )
            )
        )
        .scalars()
        .all()
    )
    # 大會（COUNCIL 階段）優先列在前，其餘維持時間排序
    meetings.sort(key=lambda m: 0 if m.bill_stage == "council" else 1)
    return [
        {
            "id": m.id,
            "title": m.title,
            "status": str(m.status),
            "bill_stage": str(m.bill_stage) if m.bill_stage else None,
            "starts_at": m.starts_at,
            "already_scheduled": m.id in linked_meeting_ids,
        }
        for m in meetings
    ]


async def schedule_into_meeting(
    session: AsyncSession,
    proposal: CouncilProposal,
    *,
    meeting_id: uuid.UUID,
    note: str | None = None,
) -> CouncilProposal:
    """常委會審查通過後，把提案直接排入指定會議（大會）議程。"""
    from api.services import meeting as meeting_svc

    meeting = await session.get(Meeting, meeting_id)
    if meeting is None:
        raise ValueError("找不到指定的會議")
    if MeetingStatus(meeting.status) not in _SCHEDULABLE_MEETING_STATUSES:
        raise ValueError("僅議程尚可編輯（草稿或已確認）的會議可排入提案")

    already = await session.scalar(
        select(MeetingAgendaItem.id).where(
            MeetingAgendaItem.meeting_id == meeting.id,
            MeetingAgendaItem.council_proposal_id == proposal.id,
        )
    )
    if already is None:
        await meeting_svc.create_agenda_item_for_council_proposal(
            session, meeting, council_proposal_id=proposal.id, note=note
        )

    proposal.scheduled_meeting_id = meeting.id
    proposal.scheduled_at = proposal.scheduled_at or datetime.now(UTC)
    proposal.status = CouncilProposalStatus.SCHEDULED
    await session.flush()
    return proposal
