"""即時開票事件流服務測試。"""

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.election import BallotBoxStatus, Election, ElectionStatus, VoteEvent
from api.models.user import User
from api.schemas.election import (
    BallotBoxCreate,
    CandidateCreate,
    ElectionCreate,
    VoteEventCreate,
)
from api.services import election as election_svc


async def _create_live_election(db: AsyncSession) -> tuple[User, Election]:
    user = User(
        id=uuid.uuid4(),
        email="counter@example.com",
        display_name="開票員",
        is_active=True,
    )
    db.add(user)
    await db.commit()
    election = await election_svc.create_election(
        db,
        ElectionCreate(
            title="第 40 屆班聯會選舉",
            candidates=[
                CandidateCreate(name="候選人 A", number=1),
                CandidateCreate(name="候選人 B", number=2, color="#dc2626"),
            ],
            ballot_boxes=[BallotBoxCreate(name="一年級票匭", expected_total_votes=100)],
        ),
        user.id,
    )
    await election_svc.set_election_status(db, election.id, ElectionStatus.LIVE)
    await election_svc.set_ballot_box_status(
        db,
        election.id,
        election.ballot_boxes[0].id,
        BallotBoxStatus.COUNTING,
    )
    return user, election


async def test_vote_events_are_aggregated_and_reversed_without_deletion(
    db_session: AsyncSession,
) -> None:
    user, election = await _create_live_election(db_session)
    candidate = election.candidates[0]
    box = election.ballot_boxes[0]

    original = await election_svc.add_vote_event(
        db_session,
        election.id,
        VoteEventCreate(ballot_box_id=box.id, candidate_id=candidate.id, delta=5),
        user.id,
    )
    await election_svc.reverse_vote_event(db_session, election.id, original.id, user.id)

    summary = await election_svc.get_live_summary(db_session, election.id)
    event_count = await db_session.scalar(
        select(func.count()).select_from(VoteEvent).where(VoteEvent.election_id == election.id)
    )

    assert summary is not None
    assert summary.total_votes == 0
    assert event_count == 2


async def test_vote_event_cannot_make_tally_negative(db_session: AsyncSession) -> None:
    user, election = await _create_live_election(db_session)

    with pytest.raises(ValueError, match="不可小於 0"):
        await election_svc.add_vote_event(
            db_session,
            election.id,
            VoteEventCreate(
                ballot_box_id=election.ballot_boxes[0].id,
                candidate_id=election.candidates[0].id,
                delta=-1,
                reason="錯誤更正",
            ),
            user.id,
        )


async def test_locked_ballot_box_rejects_new_events(db_session: AsyncSession) -> None:
    user, election = await _create_live_election(db_session)
    await election_svc.set_ballot_box_status(
        db_session,
        election.id,
        election.ballot_boxes[0].id,
        BallotBoxStatus.LOCKED,
    )

    with pytest.raises(ValueError, match="未開放記票"):
        await election_svc.add_vote_event(
            db_session,
            election.id,
            VoteEventCreate(
                ballot_box_id=election.ballot_boxes[0].id,
                candidate_id=election.candidates[0].id,
                delta=1,
            ),
            user.id,
        )
