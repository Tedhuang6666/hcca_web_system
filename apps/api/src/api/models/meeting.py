"""議事系統 ORM 模型 - 會議 / 議程 / 出列席 / 表決"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.document import Document
    from api.models.org import Org
    from api.models.regulation import Regulation
    from api.models.user import User


class MeetingStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    CLOSED = "closed"


class MeetingBillStage(StrEnum):
    """會議的法案審議階段，決定議程自動帶入哪一階段的法規修正案。

    - STANDING_COMMITTEE：常務委員會，自動帶入「送審中」(UNDER_REVIEW) 的新提案；
      表決通過後法案推進為「已排入議程」(SCHEDULED)。
    - COUNCIL：議會，自動帶入常委會通過、處於「已排入議程」(SCHEDULED) 的法案；
      表決通過後法案推進為「議會核定」(COUNCIL_APPROVED)。
    """

    STANDING_COMMITTEE = "standing_committee"
    COUNCIL = "council"


class AgendaItemType(StrEnum):
    MANUAL = "manual"
    REGULATION = "regulation"
    DOCUMENT = "document"


class AttendanceRole(StrEnum):
    VOTER = "voter"
    ATTENDEE = "attendee"
    OBSERVER = "observer"


class AttendanceStatus(StrEnum):
    EXPECTED = "expected"
    PRESENT = "present"
    ABSENT = "absent"
    LEAVE = "leave"


class VoteStatus(StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    CLOSED = "closed"


class VoteVisibility(StrEnum):
    NAMED = "named"
    ANONYMOUS = "anonymous"


class BallotChoice(StrEnum):
    APPROVE = "approve"
    REJECT = "reject"
    ABSTAIN = "abstain"


class MeetingRequestType(StrEnum):
    SPEECH = "speech"
    POINT_OF_ORDER = "point_of_order"
    PRIVILEGE = "privilege"


class MeetingRequestStatus(StrEnum):
    PENDING = "pending"
    ACKNOWLEDGED = "acknowledged"
    DISMISSED = "dismissed"


class AttendanceSourceType(StrEnum):
    CLASS_CADRES = "class_cadres"
    CLASS_MEMBERS = "class_members"
    ORG_MEMBERS = "org_members"
    POSITION_MEMBERS = "position_members"
    MANUAL = "manual"


class ArtifactLinkType(StrEnum):
    REGULATION = "regulation"
    DOCUMENT = "document"
    SURVEY = "survey"
    ANNOUNCEMENT = "announcement"
    PETITION = "petition"
    SHOP = "shop"
    MEAL = "meal"
    EXTERNAL = "external"
    CUSTOM = "custom"


class MeetingMotionType(StrEnum):
    MAIN = "main"
    AMENDMENT = "amendment"
    PROCEDURAL = "procedural"


class MeetingMotionStatus(StrEnum):
    PENDING = "pending"
    DEBATING = "debating"
    VOTING = "voting"
    ADOPTED = "adopted"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class MeetingDecisionStatus(StrEnum):
    DRAFT = "draft"
    PASSED = "passed"
    FAILED = "failed"
    RECORDED = "recorded"


class ScreenReadingMode(StrEnum):
    AGENDA = "agenda"
    ARTICLE = "article"
    ATTACHMENT = "attachment"
    VOTE = "vote"
    FREE_TEXT = "free_text"


class Meeting(Base, TimestampMixin):
    """議會會議主檔。"""

    __tablename__ = "meetings"
    __table_args__ = (
        Index("ix_meetings_status_starts_at", "status", "starts_at"),
        Index("ix_meetings_org_status", "org_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    chair_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[MeetingStatus] = mapped_column(
        String(20), nullable=False, default=MeetingStatus.DRAFT, server_default=MeetingStatus.DRAFT
    )
    expected_voters: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    quorum_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    default_pass_threshold: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    screen_token: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    checkin_token: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    current_agenda_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"), nullable=True
    )
    screen_focus_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    screen_focus_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # 法案審議階段（None 表一般會議，不自動帶入法案）
    bill_stage: Mapped[MeetingBillStage | None] = mapped_column(String(30), nullable=True)
    # 議程草稿確認時間（確認後鎖定基本設定並自動產生開會通知單）
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 開會提醒推播時間（到達 starts_at 前提醒一次，避免重複推播）
    reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 確認議程時自動建立的開會通知單公文
    notice_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )

    org: Mapped[Org] = relationship("Org")
    notice_document: Mapped[Document | None] = relationship(
        "Document", foreign_keys=[notice_document_id]
    )
    agenda_items: Mapped[list[MeetingAgendaItem]] = relationship(
        "MeetingAgendaItem",
        back_populates="meeting",
        cascade="all, delete-orphan",
        foreign_keys="MeetingAgendaItem.meeting_id",
    )
    attendance_records: Mapped[list[MeetingAttendance]] = relationship(
        "MeetingAttendance", back_populates="meeting", cascade="all, delete-orphan"
    )
    votes: Mapped[list[MeetingVote]] = relationship(
        "MeetingVote", back_populates="meeting", cascade="all, delete-orphan"
    )
    requests: Mapped[list[MeetingRequest]] = relationship(
        "MeetingRequest", back_populates="meeting", cascade="all, delete-orphan"
    )
    attendance_sources: Mapped[list[MeetingAttendanceSource]] = relationship(
        "MeetingAttendanceSource", back_populates="meeting", cascade="all, delete-orphan"
    )
    motions: Mapped[list[MeetingMotion]] = relationship(
        "MeetingMotion", back_populates="meeting", cascade="all, delete-orphan"
    )
    decisions: Mapped[list[MeetingDecision]] = relationship(
        "MeetingDecision", back_populates="meeting", cascade="all, delete-orphan"
    )
    screen_state: Mapped[MeetingScreenState | None] = relationship(
        "MeetingScreenState",
        back_populates="meeting",
        cascade="all, delete-orphan",
        uselist=False,
        single_parent=True,
    )


class MeetingAgendaItem(Base, TimestampMixin):
    """會議議程項目，可關聯法規或公文。"""

    __tablename__ = "meeting_agenda_items"
    __table_args__ = (
        Index("ix_meeting_agenda_items_meeting_order", "meeting_id", "order_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_type: Mapped[AgendaItemType] = mapped_column(
        String(20), nullable=False, default=AgendaItemType.MANUAL, server_default=AgendaItemType.MANUAL
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    regulation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("regulations.id", ondelete="SET NULL"), nullable=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)

    meeting: Mapped[Meeting] = relationship(
        "Meeting", back_populates="agenda_items", foreign_keys=[meeting_id]
    )
    regulation: Mapped[Regulation | None] = relationship("Regulation")
    document: Mapped[Document | None] = relationship("Document")
    votes: Mapped[list[MeetingVote]] = relationship("MeetingVote", back_populates="agenda_item")
    attachments: Mapped[list[MeetingAgendaAttachment]] = relationship(
        "MeetingAgendaAttachment", back_populates="agenda_item", cascade="all, delete-orphan"
    )
    artifact_links: Mapped[list[MeetingArtifactLink]] = relationship(
        "MeetingArtifactLink", back_populates="agenda_item", cascade="all, delete-orphan"
    )
    motions: Mapped[list[MeetingMotion]] = relationship("MeetingMotion", back_populates="agenda_item")
    decisions: Mapped[list[MeetingDecision]] = relationship(
        "MeetingDecision", back_populates="agenda_item"
    )


class MeetingAgendaAttachment(Base, TimestampMixin):
    """議程項目附件，可為檔案或外部連結。"""

    __tablename__ = "meeting_agenda_attachments"
    __table_args__ = (
        Index("ix_meeting_agenda_attachments_item_created", "agenda_item_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agenda_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meeting_agenda_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    link_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    agenda_item: Mapped[MeetingAgendaItem] = relationship(
        "MeetingAgendaItem", back_populates="attachments"
    )
    uploader: Mapped[User] = relationship("User")


class MeetingAttendance(Base, TimestampMixin):
    """會議出席、列席與表決權名冊。"""

    __tablename__ = "meeting_attendance"
    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id", name="uq_meeting_attendance_user"),
        Index("ix_meeting_attendance_meeting_status", "meeting_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[AttendanceRole] = mapped_column(
        String(20), nullable=False, default=AttendanceRole.ATTENDEE, server_default=AttendanceRole.ATTENDEE
    )
    status: Mapped[AttendanceStatus] = mapped_column(
        String(20), nullable=False, default=AttendanceStatus.EXPECTED, server_default=AttendanceStatus.EXPECTED
    )
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_voting_eligible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    proxy_for_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="attendance_records")
    user: Mapped[User] = relationship("User", foreign_keys=[user_id])
    proxy_for_user: Mapped[User | None] = relationship("User", foreign_keys=[proxy_for_user_id])


class MeetingAttendanceSource(Base, TimestampMixin):
    """名冊匯入來源，保留班級/組織/職位等來源標籤供稽核。"""

    __tablename__ = "meeting_attendance_sources"
    __table_args__ = (
        Index("ix_meeting_attendance_sources_meeting", "meeting_id", "source_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_type: Mapped[AttendanceSourceType] = mapped_column(String(30), nullable=False)
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[AttendanceRole] = mapped_column(
        String(20), nullable=False, default=AttendanceRole.ATTENDEE, server_default=AttendanceRole.ATTENDEE
    )
    is_voting_eligible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    imported_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="attendance_sources")
    creator: Mapped[User] = relationship("User")


class MeetingArtifactLink(Base, TimestampMixin):
    """議程資料包關聯：平台內物件、外部連結或自訂資料。"""

    __tablename__ = "meeting_artifact_links"
    __table_args__ = (
        Index("ix_meeting_artifact_links_item_type", "agenda_item_id", "artifact_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agenda_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meeting_agenda_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    artifact_type: Mapped[ArtifactLinkType] = mapped_column(String(30), nullable=False)
    object_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    agenda_item: Mapped[MeetingAgendaItem] = relationship(
        "MeetingAgendaItem", back_populates="artifact_links"
    )
    creator: Mapped[User] = relationship("User")


class MeetingVote(Base, TimestampMixin):
    """會議表決案。"""

    __tablename__ = "meeting_votes"
    __table_args__ = (
        Index("ix_meeting_votes_meeting_status", "meeting_id", "status"),
        Index("ix_meeting_votes_agenda_item", "agenda_item_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agenda_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[VoteVisibility] = mapped_column(
        String(20), nullable=False, default=VoteVisibility.NAMED, server_default=VoteVisibility.NAMED
    )
    status: Mapped[VoteStatus] = mapped_column(
        String(20), nullable=False, default=VoteStatus.DRAFT, server_default=VoteStatus.DRAFT
    )
    pass_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="votes")
    agenda_item: Mapped[MeetingAgendaItem | None] = relationship(
        "MeetingAgendaItem", back_populates="votes"
    )
    ballots: Mapped[list[MeetingBallot]] = relationship(
        "MeetingBallot", back_populates="vote", cascade="all, delete-orphan"
    )
    motions: Mapped[list[MeetingMotion]] = relationship("MeetingMotion", back_populates="vote")
    decisions: Mapped[list[MeetingDecision]] = relationship("MeetingDecision", back_populates="vote")


class MeetingBallot(Base, TimestampMixin):
    """表決票。匿名案一般輸出不揭露此明細，但仍保留稽核資料。"""

    __tablename__ = "meeting_ballots"
    __table_args__ = (
        UniqueConstraint("vote_id", "voter_id", name="uq_meeting_ballot_voter"),
        Index("ix_meeting_ballots_vote_choice", "vote_id", "choice"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vote_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_votes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    voter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    choice: Mapped[BallotChoice] = mapped_column(String(20), nullable=False)
    cast_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    vote: Mapped[MeetingVote] = relationship("MeetingVote", back_populates="ballots")
    voter: Mapped[User] = relationship("User")


class MeetingRequest(Base, TimestampMixin):
    """議員現場請求：發言、秩序問題、權宜問題。"""

    __tablename__ = "meeting_requests"
    __table_args__ = (
        Index("ix_meeting_requests_meeting_status", "meeting_id", "status"),
        Index("ix_meeting_requests_meeting_created", "meeting_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    request_type: Mapped[MeetingRequestType] = mapped_column(String(30), nullable=False)
    status: Mapped[MeetingRequestStatus] = mapped_column(
        String(20),
        nullable=False,
        default=MeetingRequestStatus.PENDING,
        server_default=MeetingRequestStatus.PENDING,
    )
    agenda_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"), nullable=True
    )
    content: Mapped[str | None] = mapped_column(Text, nullable=True)

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="requests")
    user: Mapped[User] = relationship("User")
    agenda_item: Mapped[MeetingAgendaItem | None] = relationship("MeetingAgendaItem")


class MeetingMotion(Base, TimestampMixin):
    """會中動議、修正動議與程序動議。"""

    __tablename__ = "meeting_motions"
    __table_args__ = (
        Index("ix_meeting_motions_meeting_status", "meeting_id", "status"),
        Index("ix_meeting_motions_agenda", "agenda_item_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agenda_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"), nullable=True
    )
    proposer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    motion_type: Mapped[MeetingMotionType] = mapped_column(
        String(30), nullable=False, default=MeetingMotionType.MAIN, server_default=MeetingMotionType.MAIN
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[MeetingMotionStatus] = mapped_column(
        String(30),
        nullable=False,
        default=MeetingMotionStatus.PENDING,
        server_default=MeetingMotionStatus.PENDING,
    )
    vote_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_votes.id", ondelete="SET NULL"), nullable=True
    )

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="motions")
    agenda_item: Mapped[MeetingAgendaItem | None] = relationship(
        "MeetingAgendaItem", back_populates="motions"
    )
    proposer: Mapped[User | None] = relationship("User")
    vote: Mapped[MeetingVote | None] = relationship("MeetingVote", back_populates="motions")


class MeetingDecision(Base, TimestampMixin):
    """正式決議，連結議程、動議、表決與可能的法規推進。"""

    __tablename__ = "meeting_decisions"
    __table_args__ = (
        Index("ix_meeting_decisions_meeting_status", "meeting_id", "status"),
        Index("ix_meeting_decisions_agenda", "agenda_item_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agenda_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meeting_agenda_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    motion_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_motions.id", ondelete="SET NULL"), nullable=True
    )
    vote_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_votes.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[MeetingDecisionStatus] = mapped_column(
        String(30),
        nullable=False,
        default=MeetingDecisionStatus.DRAFT,
        server_default=MeetingDecisionStatus.DRAFT,
    )
    regulation_transition_to: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="decisions")
    agenda_item: Mapped[MeetingAgendaItem] = relationship(
        "MeetingAgendaItem", back_populates="decisions"
    )
    motion: Mapped[MeetingMotion | None] = relationship("MeetingMotion")
    vote: Mapped[MeetingVote | None] = relationship("MeetingVote", back_populates="decisions")
    creator: Mapped[User] = relationship("User")


class MeetingScreenState(Base, TimestampMixin):
    """公開大屏的即時閱讀/附件顯示狀態。"""

    __tablename__ = "meeting_screen_states"

    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), primary_key=True
    )
    agenda_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"), nullable=True
    )
    reading_mode: Mapped[ScreenReadingMode] = mapped_column(
        String(30), nullable=False, default=ScreenReadingMode.AGENDA, server_default=ScreenReadingMode.AGENDA
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_attachment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meeting_agenda_attachments.id", ondelete="SET NULL"), nullable=True
    )
    scroll_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    auto_scroll: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    scroll_speed: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    is_fullscreen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="screen_state")
    agenda_item: Mapped[MeetingAgendaItem | None] = relationship("MeetingAgendaItem")
    active_attachment: Mapped[MeetingAgendaAttachment | None] = relationship("MeetingAgendaAttachment")
    updater: Mapped[User | None] = relationship("User")
