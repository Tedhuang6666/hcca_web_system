"""行事曆 ORM 模型 - 跨模組時間中樞。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.meeting import Meeting
    from api.models.org import Org
    from api.models.user import User


class CalendarEventType(StrEnum):
    ACTIVITY = "activity"
    PREPARATION = "preparation"
    REHEARSAL = "rehearsal"
    INTERSCHOOL_MEETING = "interschool_meeting"
    FORMAL_MEETING = "formal_meeting"
    DEADLINE = "deadline"
    OTHER = "other"


class CalendarEventStatus(StrEnum):
    TENTATIVE = "tentative"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    DONE = "done"


class CalendarVisibility(StrEnum):
    PRIVATE = "private"
    PARTICIPANTS = "participants"
    ORG = "org"
    LOGGED_IN = "logged_in"
    PUBLIC = "public"


class CalendarParticipantRole(StrEnum):
    OWNER = "owner"
    ORGANIZER = "organizer"
    REQUIRED = "required"
    OPTIONAL = "optional"


class CalendarParticipantResponse(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    TENTATIVE = "tentative"


class CalendarLinkType(StrEnum):
    DOCUMENT = "document"
    MEETING = "meeting"
    SURVEY = "survey"
    ANNOUNCEMENT = "announcement"
    EXTERNAL = "external"
    CUSTOM = "custom"


class CalendarEvent(Base, TimestampMixin):
    """行事曆事件主檔。"""

    __tablename__ = "calendar_events"
    __table_args__ = (
        Index("ix_calendar_events_range", "starts_at", "ends_at"),
        Index("ix_calendar_events_org_range", "org_id", "starts_at", "ends_at"),
        Index("ix_calendar_events_type_status", "event_type", "status"),
        Index("ix_calendar_events_source", "source_module", "source_id", "source_key"),
        UniqueConstraint("source_meeting_id", name="uq_calendar_events_source_meeting"),
        UniqueConstraint(
            "source_module", "source_id", "source_key", name="uq_calendar_events_source"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_type: Mapped[CalendarEventType] = mapped_column(
        String(30),
        nullable=False,
        default=CalendarEventType.ACTIVITY,
        server_default=CalendarEventType.ACTIVITY,
        index=True,
    )
    status: Mapped[CalendarEventStatus] = mapped_column(
        String(20),
        nullable=False,
        default=CalendarEventStatus.CONFIRMED,
        server_default=CalendarEventStatus.CONFIRMED,
        index=True,
    )
    visibility: Mapped[CalendarVisibility] = mapped_column(
        String(20),
        nullable=False,
        default=CalendarVisibility.ORG,
        server_default=CalendarVisibility.ORG,
        index=True,
    )
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    all_day: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    source_meeting_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=True, index=True
    )
    google_event_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    source_module: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )
    source_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    href: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    org: Mapped[Org | None] = relationship("Org")
    source_meeting: Mapped[Meeting | None] = relationship("Meeting")
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by])
    updater: Mapped[User | None] = relationship("User", foreign_keys=[updated_by])
    participants: Mapped[list[CalendarEventParticipant]] = relationship(
        "CalendarEventParticipant", back_populates="event", cascade="all, delete-orphan"
    )
    checklist_items: Mapped[list[CalendarEventChecklistItem]] = relationship(
        "CalendarEventChecklistItem", back_populates="event", cascade="all, delete-orphan"
    )
    links: Mapped[list[CalendarEventLink]] = relationship(
        "CalendarEventLink", back_populates="event", cascade="all, delete-orphan"
    )


class CalendarEventParticipant(Base, TimestampMixin):
    """行事曆參與者與回覆狀態。"""

    __tablename__ = "calendar_event_participants"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_calendar_event_participant_user"),
        Index("ix_calendar_event_participants_user", "user_id", "response"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[CalendarParticipantRole] = mapped_column(
        String(20),
        nullable=False,
        default=CalendarParticipantRole.REQUIRED,
        server_default=CalendarParticipantRole.REQUIRED,
    )
    response: Mapped[CalendarParticipantResponse] = mapped_column(
        String(20),
        nullable=False,
        default=CalendarParticipantResponse.PENDING,
        server_default=CalendarParticipantResponse.PENDING,
    )

    event: Mapped[CalendarEvent] = relationship("CalendarEvent", back_populates="participants")
    user: Mapped[User] = relationship("User")


class CalendarEventChecklistItem(Base, TimestampMixin):
    """活動準備事項與彩排檢核。"""

    __tablename__ = "calendar_event_checklist_items"
    __table_args__ = (Index("ix_calendar_event_checklist_event_done", "event_id", "is_done"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event: Mapped[CalendarEvent] = relationship("CalendarEvent", back_populates="checklist_items")
    assignee: Mapped[User | None] = relationship("User")


class CalendarEventLink(Base, TimestampMixin):
    """事件關聯的平台物件或外部連結。"""

    __tablename__ = "calendar_event_links"
    __table_args__ = (Index("ix_calendar_event_links_event_type", "event_id", "link_type"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False
    )
    link_type: Mapped[CalendarLinkType] = mapped_column(String(30), nullable=False)
    object_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    event: Mapped[CalendarEvent] = relationship("CalendarEvent", back_populates="links")
    creator: Mapped[User] = relationship("User")
