"""議會提案 ORM 模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class CouncilProposalStatus(StrEnum):
    SUBMITTED = "submitted"
    COMMITTEE_REVIEW = "committee_review"
    SCHEDULED = "scheduled"
    COUNCIL_REVIEW = "council_review"
    PASSED = "passed"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class CouncilProposalKind(StrEnum):
    ENACT = "enact"
    AMEND = "amend"
    ABOLISH = "abolish"


class CouncilProposal(Base, TimestampMixin):
    """學生向議會提出的議案，先經常委審查再排入議程。"""

    __tablename__ = "council_proposals"
    __table_args__ = (
        Index("ix_council_proposals_status_created", "status", "created_at"),
        Index("ix_council_proposals_submitter_status", "submitter_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    serial_number: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    submitter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    contact_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_email: Mapped[str] = mapped_column(String(255), nullable=False)
    proposer_name: Mapped[str] = mapped_column(String(100), nullable=False)
    co_sponsors: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[CouncilProposalKind] = mapped_column(String(20), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    legal_basis: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposal_text: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    expected_effect: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[CouncilProposalStatus] = mapped_column(
        String(30),
        nullable=False,
        default=CouncilProposalStatus.SUBMITTED,
        server_default=CouncilProposalStatus.SUBMITTED,
        index=True,
    )
    committee_review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    scheduled_meeting_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    submitter: Mapped[User | None] = relationship("User")


__all__ = [
    "CouncilProposal",
    "CouncilProposalKind",
    "CouncilProposalStatus",
]
