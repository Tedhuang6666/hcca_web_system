"""即時開票紀錄系統 ORM 模型。"""

from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class ElectionStatus(enum.StrEnum):
    DRAFT = "draft"
    LIVE = "live"
    PAUSED = "paused"
    CLOSED = "closed"


class BallotBoxStatus(enum.StrEnum):
    PENDING = "pending"
    COUNTING = "counting"
    PAUSED = "paused"
    LOCKED = "locked"


class VoteEventKind(enum.StrEnum):
    CANDIDATE = "candidate"
    INVALID = "invalid"


class Election(Base, TimestampMixin):
    __tablename__ = "elections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ElectionStatus.DRAFT.value, index=True
    )
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    created_by: Mapped[User] = relationship("User")
    candidates: Mapped[list[Candidate]] = relationship(
        "Candidate",
        back_populates="election",
        cascade="all, delete-orphan",
        order_by="Candidate.sort_order",
    )
    ballot_boxes: Mapped[list[BallotBox]] = relationship(
        "BallotBox",
        back_populates="election",
        cascade="all, delete-orphan",
        order_by="BallotBox.sort_order",
    )


class Candidate(Base, TimestampMixin):
    __tablename__ = "election_candidates"
    __table_args__ = (
        UniqueConstraint("election_id", "number", name="uq_election_candidate_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    election_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("elections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#2563eb")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    election: Mapped[Election] = relationship("Election", back_populates="candidates")
    members: Mapped[list[CandidateMember]] = relationship(
        "CandidateMember",
        back_populates="candidate",
        cascade="all, delete-orphan",
        order_by="CandidateMember.sort_order",
    )


class CandidateMember(Base, TimestampMixin):
    __tablename__ = "election_candidate_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("election_candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    candidate: Mapped[Candidate] = relationship("Candidate", back_populates="members")


class BallotBox(Base, TimestampMixin):
    __tablename__ = "election_ballot_boxes"
    __table_args__ = (UniqueConstraint("election_id", "name", name="uq_election_ballot_box_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    election_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("elections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=BallotBoxStatus.PENDING.value, index=True
    )
    expected_total_votes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    election: Mapped[Election] = relationship("Election", back_populates="ballot_boxes")


class VoteEvent(Base, TimestampMixin):
    __tablename__ = "vote_events"
    __table_args__ = (
        Index("ix_vote_events_election_created", "election_id", "created_at"),
        Index("ix_vote_events_box_candidate", "ballot_box_id", "candidate_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    election_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("elections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ballot_box_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("election_ballot_boxes.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("election_candidates.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(300), nullable=False)
    operator_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    reverses_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vote_events.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
    )

    ballot_box: Mapped[BallotBox] = relationship("BallotBox")
    candidate: Mapped[Candidate | None] = relationship("Candidate")
    operator: Mapped[User] = relationship("User")
    reverses_event: Mapped[VoteEvent | None] = relationship(
        "VoteEvent", remote_side="VoteEvent.id", uselist=False
    )


__all__ = [
    "BallotBox",
    "BallotBoxStatus",
    "Candidate",
    "CandidateMember",
    "Election",
    "ElectionStatus",
    "VoteEvent",
    "VoteEventKind",
]
