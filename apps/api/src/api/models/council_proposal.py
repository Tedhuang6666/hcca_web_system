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
    from api.models.regulation import Regulation
    from api.models.user import User


class CouncilProposalStatus(StrEnum):
    SUBMITTED = "submitted"
    COMMITTEE_REVIEW = "committee_review"
    SCHEDULED = "scheduled"
    COUNCIL_REVIEW = "council_review"
    PASSED = "passed"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    PUBLISHED = "published"


class CouncilProposalCaseType(StrEnum):
    """議會可審理的案件大類。"""

    REGULATION = "regulation"  # 法規案（自治條例之制定/修正/廢止）
    FINANCE = "finance"  # 財政案（預算/決算/結算）
    RECALL = "recall"  # 罷免案
    IMPEACHMENT = "impeachment"  # 彈劾案
    PERSONNEL = "personnel"  # 人事案（同意權行使）
    RESOLUTION = "resolution"  # 決議案與建議案


class CouncilProposalKind(StrEnum):
    """法規案的子類型；僅 case_type=regulation 時適用。"""

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
    case_type: Mapped[CouncilProposalCaseType] = mapped_column(
        String(20),
        nullable=False,
        default=CouncilProposalCaseType.REGULATION,
        server_default=CouncilProposalCaseType.REGULATION,
        index=True,
    )
    # kind 僅用於法規案（制定/修正/廢止）；其他案件類型為 NULL。
    kind: Mapped[CouncilProposalKind | None] = mapped_column(String(20), nullable=True, index=True)
    # 法規案連結既有法規（修正/廢止案必填；制定案可留空，待立法後回填）。
    regulation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
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
        UUID(as_uuid=True),
        # use_alter：打破 council_proposals → meetings → meeting_agenda_items → council_proposals 循環。
        ForeignKey(
            "meetings.id",
            ondelete="SET NULL",
            name="council_proposals_scheduled_meeting_id_fkey",
            use_alter=True,
        ),
        nullable=True,
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    submitter: Mapped[User | None] = relationship("User")
    regulation: Mapped[Regulation | None] = relationship("Regulation", lazy="raise_on_sql")

    @property
    def regulation_title(self) -> str | None:
        """連結法規的標題；需先 eager-load regulation 關聯。"""
        return self.regulation.title if self.regulation else None


__all__ = [
    "CouncilProposal",
    "CouncilProposalCaseType",
    "CouncilProposalKind",
    "CouncilProposalStatus",
]
