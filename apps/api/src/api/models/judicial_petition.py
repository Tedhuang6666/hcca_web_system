"""評議委員會提訴訟 ORM 模型。"""

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


class JudicialPetitionStatus(StrEnum):
    SUBMITTED = "submitted"
    DOCKETING_REVIEW = "docketing_review"
    ACCEPTED = "accepted"
    IN_REVIEW = "in_review"
    DECIDED = "decided"
    DISMISSED = "dismissed"
    WITHDRAWN = "withdrawn"
    PUBLISHED = "published"


class JudicialPetitionType(StrEnum):
    CONSTITUTIONAL_NORM_REVIEW = "constitutional_norm_review"
    ORG_DISPUTE = "org_dispute"
    ELECTION_DISPUTE = "election_dispute"
    DISCIPLINARY_APPEAL = "disciplinary_appeal"
    OTHER = "other"


class JudicialPetition(Base, TimestampMixin):
    """向評議委員會提出的訴訟或法規範違憲審查聲請。"""

    __tablename__ = "judicial_petitions"
    __table_args__ = (
        Index("ix_judicial_petitions_status_created", "status", "created_at"),
        Index("ix_judicial_petitions_submitter_status", "submitter_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    docket_number: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    submitter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    petitioner_name: Mapped[str] = mapped_column(String(100), nullable=False)
    petitioner_email: Mapped[str] = mapped_column(String(255), nullable=False)
    representative: Mapped[str | None] = mapped_column(String(100), nullable=True)
    respondent: Mapped[str | None] = mapped_column(String(200), nullable=True)
    petition_type: Mapped[JudicialPetitionType] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    challenged_norm: Mapped[str] = mapped_column(Text, nullable=False)
    constitutional_provisions: Mapped[str] = mapped_column(Text, nullable=False)
    petition_claim: Mapped[str] = mapped_column(Text, nullable=False)
    facts_and_reasons: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachments_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[JudicialPetitionStatus] = mapped_column(
        String(30),
        nullable=False,
        default=JudicialPetitionStatus.SUBMITTED,
        server_default=JudicialPetitionStatus.SUBMITTED,
        index=True,
    )
    docketing_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    submitter: Mapped[User | None] = relationship("User")


__all__ = [
    "JudicialPetition",
    "JudicialPetitionStatus",
    "JudicialPetitionType",
]
