"""即時開票紀錄系統業務邏輯。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.election import (
    BallotBox,
    BallotBoxStatus,
    Candidate,
    CandidateMember,
    Election,
    ElectionStatus,
    VoteEvent,
    VoteEventKind,
)
from api.schemas.election import (
    BallotBoxTally,
    CandidateTally,
    ElectionCreate,
    ElectionLiveSummary,
    ElectionUpdate,
    VoteEventCreate,
    VoteEventOut,
)


async def get_election(session: AsyncSession, election_id: uuid.UUID) -> Election | None:
    result = await session.execute(
        select(Election)
        .options(
            selectinload(Election.candidates).selectinload(Candidate.members),
            selectinload(Election.ballot_boxes),
        )
        .where(Election.id == election_id)
    )
    return result.scalar_one_or_none()


async def list_elections(session: AsyncSession) -> list[Election]:
    result = await session.execute(select(Election).order_by(Election.created_at.desc()))
    return list(result.scalars())


async def list_public_elections(session: AsyncSession) -> list[Election]:
    result = await session.execute(
        select(Election)
        .where(
            Election.is_public.is_(True),
            Election.status != ElectionStatus.DRAFT.value,
        )
        .order_by(Election.updated_at.desc(), Election.created_at.desc())
    )
    return list(result.scalars())


async def create_election(
    session: AsyncSession, payload: ElectionCreate, created_by_id: uuid.UUID
) -> Election:
    election = Election(
        title=payload.title.strip(),
        description=payload.description,
        is_public=payload.is_public,
        created_by_id=created_by_id,
    )
    election.candidates = [
        Candidate(
            name=item.name.strip(),
            number=item.number,
            color=item.color,
            sort_order=item.sort_order,
            members=[
                CandidateMember(
                    position=member.position.strip(),
                    name=member.name.strip(),
                    sort_order=member.sort_order,
                )
                for member in item.members
            ],
        )
        for item in payload.candidates
    ]
    election.ballot_boxes = [
        BallotBox(
            name=item.name.strip(),
            expected_total_votes=item.expected_total_votes,
            sort_order=item.sort_order,
        )
        for item in payload.ballot_boxes
    ]
    session.add(election)
    await session.commit()
    return await get_election(session, election.id)  # type: ignore[return-value]


async def update_election(
    session: AsyncSession, election: Election, payload: ElectionUpdate
) -> Election:
    if election.status != ElectionStatus.DRAFT.value:
        raise ValueError("只有草稿選舉可修改基本資料")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(election, field, value.strip() if isinstance(value, str) else value)
    await session.commit()
    return await get_election(session, election.id)  # type: ignore[return-value]


async def set_election_status(
    session: AsyncSession, election_id: uuid.UUID, target: ElectionStatus
) -> Election:
    election = await session.scalar(
        select(Election).where(Election.id == election_id).with_for_update()
    )
    if election is None:
        raise LookupError("找不到此選舉")
    allowed = {
        ElectionStatus.DRAFT.value: {ElectionStatus.LIVE},
        ElectionStatus.LIVE.value: {ElectionStatus.PAUSED, ElectionStatus.CLOSED},
        ElectionStatus.PAUSED.value: {ElectionStatus.LIVE, ElectionStatus.CLOSED},
        ElectionStatus.CLOSED.value: set(),
    }
    if target not in allowed[election.status]:
        raise ValueError(f"不可從 {election.status} 變更為 {target.value}")
    election.status = target.value
    await session.commit()
    return await get_election(session, election.id)  # type: ignore[return-value]


async def set_ballot_box_status(
    session: AsyncSession,
    election_id: uuid.UUID,
    ballot_box_id: uuid.UUID,
    target: BallotBoxStatus,
) -> BallotBox:
    box = await session.scalar(
        select(BallotBox)
        .where(BallotBox.id == ballot_box_id, BallotBox.election_id == election_id)
        .with_for_update()
    )
    if box is None:
        raise LookupError("找不到此票匭")
    allowed = {
        BallotBoxStatus.PENDING.value: {
            BallotBoxStatus.COUNTING,
            BallotBoxStatus.PAUSED,
            BallotBoxStatus.LOCKED,
        },
        BallotBoxStatus.COUNTING.value: {BallotBoxStatus.PAUSED, BallotBoxStatus.LOCKED},
        BallotBoxStatus.PAUSED.value: {BallotBoxStatus.COUNTING, BallotBoxStatus.LOCKED},
        BallotBoxStatus.LOCKED.value: set(),
    }
    if target not in allowed[box.status]:
        raise ValueError(f"不可從 {box.status} 變更為 {target.value}")
    box.status = target.value
    await session.commit()
    await session.refresh(box)
    return box


async def add_vote_event(
    session: AsyncSession,
    election_id: uuid.UUID,
    payload: VoteEventCreate,
    operator_id: uuid.UUID,
) -> VoteEvent:
    election = await session.scalar(
        select(Election).where(Election.id == election_id).with_for_update()
    )
    if election is None:
        raise LookupError("找不到此選舉")
    if election.status != ElectionStatus.LIVE.value:
        raise ValueError("選舉必須處於開票中才能記票")

    box = await session.scalar(
        select(BallotBox)
        .where(BallotBox.id == payload.ballot_box_id, BallotBox.election_id == election_id)
        .with_for_update()
    )
    if box is None:
        raise ValueError("票匭不屬於此選舉")
    if box.status != BallotBoxStatus.COUNTING.value:
        raise ValueError("此票匭目前未開放記票")

    if payload.candidate_id is not None:
        candidate = await session.scalar(
            select(Candidate).where(
                Candidate.id == payload.candidate_id,
                Candidate.election_id == election_id,
                Candidate.is_active.is_(True),
            )
        )
        if candidate is None:
            raise ValueError("候選人不屬於此選舉")

    current = await session.scalar(
        select(func.coalesce(func.sum(VoteEvent.delta), 0)).where(
            VoteEvent.ballot_box_id == box.id,
            VoteEvent.kind == payload.kind.value,
            VoteEvent.candidate_id == payload.candidate_id,
        )
    )
    if int(current or 0) + payload.delta < 0:
        raise ValueError("更正後票數不可小於 0")

    event = VoteEvent(
        election_id=election_id,
        ballot_box_id=box.id,
        candidate_id=payload.candidate_id,
        kind=payload.kind.value,
        delta=payload.delta,
        reason=payload.reason.strip(),
        operator_id=operator_id,
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return event


async def reverse_vote_event(
    session: AsyncSession,
    election_id: uuid.UUID,
    event_id: uuid.UUID,
    operator_id: uuid.UUID,
) -> VoteEvent:
    original = await session.scalar(
        select(VoteEvent)
        .where(VoteEvent.id == event_id, VoteEvent.election_id == election_id)
        .with_for_update()
    )
    if original is None:
        raise LookupError("找不到此票數事件")
    reversed_id = await session.scalar(
        select(VoteEvent.id).where(VoteEvent.reverses_event_id == original.id)
    )
    if reversed_id is not None:
        raise ValueError("此事件已撤銷")
    election = await session.scalar(
        select(Election).where(Election.id == election_id).with_for_update()
    )
    box = await session.scalar(
        select(BallotBox).where(BallotBox.id == original.ballot_box_id).with_for_update()
    )
    if election is None or election.status != ElectionStatus.LIVE.value:
        raise ValueError("選舉必須處於開票中才能撤銷")
    if box is None or box.status != BallotBoxStatus.COUNTING.value:
        raise ValueError("票匭必須處於開票中才能撤銷")
    current = await session.scalar(
        select(func.coalesce(func.sum(VoteEvent.delta), 0)).where(
            VoteEvent.ballot_box_id == original.ballot_box_id,
            VoteEvent.kind == original.kind,
            VoteEvent.candidate_id == original.candidate_id,
        )
    )
    if int(current or 0) - original.delta < 0:
        raise ValueError("撤銷後票數不可小於 0")
    reversal = VoteEvent(
        election_id=election_id,
        ballot_box_id=original.ballot_box_id,
        candidate_id=original.candidate_id,
        kind=original.kind,
        delta=-original.delta,
        reason=f"撤銷事件 {original.id}",
        operator_id=operator_id,
        reverses_event_id=original.id,
    )
    session.add(reversal)
    await session.commit()
    await session.refresh(reversal)
    return reversal


async def get_vote_event_out(
    session: AsyncSession, election_id: uuid.UUID, event_id: uuid.UUID
) -> VoteEventOut | None:
    result = await session.execute(
        select(VoteEvent, BallotBox.name, Candidate.name)
        .join(BallotBox, BallotBox.id == VoteEvent.ballot_box_id)
        .outerjoin(Candidate, Candidate.id == VoteEvent.candidate_id)
        .options(selectinload(VoteEvent.operator))
        .where(VoteEvent.election_id == election_id, VoteEvent.id == event_id)
    )
    row = result.one_or_none()
    if row is None:
        return None
    event, box_name, candidate_name = row
    return VoteEventOut(
        id=event.id,
        election_id=event.election_id,
        ballot_box_id=event.ballot_box_id,
        candidate_id=event.candidate_id,
        kind=event.kind,
        delta=event.delta,
        reason=event.reason,
        operator_id=event.operator_id,
        operator_name=event.operator.display_name,
        ballot_box_name=box_name,
        candidate_name=candidate_name,
        reverses_event_id=event.reverses_event_id,
        created_at=event.created_at,
    )


async def list_vote_events(
    session: AsyncSession, election_id: uuid.UUID, limit: int = 100
) -> list[VoteEventOut]:
    result = await session.execute(
        select(VoteEvent, BallotBox.name, Candidate.name)
        .join(BallotBox, BallotBox.id == VoteEvent.ballot_box_id)
        .outerjoin(Candidate, Candidate.id == VoteEvent.candidate_id)
        .options(selectinload(VoteEvent.operator))
        .where(VoteEvent.election_id == election_id)
        .order_by(VoteEvent.created_at.desc())
        .limit(limit)
    )
    return [
        VoteEventOut(
            id=event.id,
            election_id=event.election_id,
            ballot_box_id=event.ballot_box_id,
            candidate_id=event.candidate_id,
            kind=event.kind,
            delta=event.delta,
            reason=event.reason,
            operator_id=event.operator_id,
            operator_name=event.operator.display_name,
            ballot_box_name=box_name,
            candidate_name=candidate_name,
            reverses_event_id=event.reverses_event_id,
            created_at=event.created_at,
        )
        for event, box_name, candidate_name in result.all()
    ]


async def get_live_summary(
    session: AsyncSession, election_id: uuid.UUID
) -> ElectionLiveSummary | None:
    election = await get_election(session, election_id)
    if election is None:
        return None
    rows = (
        await session.execute(
            select(
                VoteEvent.ballot_box_id,
                VoteEvent.candidate_id,
                VoteEvent.kind,
                func.coalesce(func.sum(VoteEvent.delta), 0),
            )
            .where(VoteEvent.election_id == election_id)
            .group_by(VoteEvent.ballot_box_id, VoteEvent.candidate_id, VoteEvent.kind)
        )
    ).all()
    totals: dict[uuid.UUID, int] = {candidate.id: 0 for candidate in election.candidates}
    box_valid: dict[uuid.UUID, int] = {box.id: 0 for box in election.ballot_boxes}
    box_invalid: dict[uuid.UUID, int] = {box.id: 0 for box in election.ballot_boxes}
    for box_id, candidate_id, kind, amount in rows:
        votes = int(amount)
        if kind == VoteEventKind.INVALID.value:
            box_invalid[box_id] += votes
        elif candidate_id is not None:
            totals[candidate_id] = totals.get(candidate_id, 0) + votes
            box_valid[box_id] += votes

    valid_votes = sum(totals.values())
    invalid_votes = sum(box_invalid.values())
    total_votes = valid_votes + invalid_votes
    expected_values = [box.expected_total_votes for box in election.ballot_boxes]
    expected_total = (
        sum(value for value in expected_values if value is not None)
        if expected_values and all(value is not None for value in expected_values)
        else None
    )
    leader_id = max(totals, key=totals.get) if valid_votes and totals else None
    last_event_at = await session.scalar(
        select(func.max(VoteEvent.created_at)).where(VoteEvent.election_id == election_id)
    )

    return ElectionLiveSummary(
        election_id=election.id,
        title=election.title,
        status=election.status,
        total_votes=total_votes,
        valid_votes=valid_votes,
        invalid_votes=invalid_votes,
        expected_total_votes=expected_total,
        progress_percentage=(
            round(total_votes / expected_total * 100, 1) if expected_total else None
        ),
        leader_candidate_id=leader_id,
        current_ballot_boxes=[
            box.name
            for box in election.ballot_boxes
            if box.status == BallotBoxStatus.COUNTING.value
        ],
        candidates=[
            CandidateTally(
                candidate_id=candidate.id,
                name=candidate.name,
                number=candidate.number,
                color=candidate.color,
                members=candidate.members,
                votes=totals[candidate.id],
                percentage=round(totals[candidate.id] / valid_votes * 100, 1) if valid_votes else 0,
            )
            for candidate in election.candidates
            if candidate.is_active
        ],
        ballot_boxes=[
            BallotBoxTally(
                ballot_box_id=box.id,
                name=box.name,
                status=box.status,
                counted_votes=box_valid[box.id] + box_invalid[box.id],
                invalid_votes=box_invalid[box.id],
                expected_total_votes=box.expected_total_votes,
                progress_percentage=(
                    round(
                        (box_valid[box.id] + box_invalid[box.id]) / box.expected_total_votes * 100,
                        1,
                    )
                    if box.expected_total_votes
                    else None
                ),
            )
            for box in election.ballot_boxes
        ],
        last_updated_at=last_event_at or election.updated_at or datetime.now(UTC),
    )
