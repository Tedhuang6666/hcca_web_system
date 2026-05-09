"""陳情系統 ORM 模型 - PetitionType / PetitionCase / Event / Attachment"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.user import User


class PetitionStatus(enum.StrEnum):
    SUBMITTED = "submitted"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    NEEDS_INFO = "needs_info"
    TRANSFERRED = "transferred"
    RESOLVED = "resolved"
    CLOSED = "closed"
    REJECTED = "rejected"


class PetitionEventType(enum.StrEnum):
    CREATED = "created"
    ASSIGNED = "assigned"
    STATUS_CHANGED = "status_changed"
    TRANSFERRED = "transferred"
    NEEDS_INFO = "needs_info"
    SUPPLEMENTED = "supplemented"
    REPLIED = "replied"
    CLOSED = "closed"
    REJECTED = "rejected"
    NOTE = "note"
    ATTACHMENT_ADDED = "attachment_added"


class PetitionEventVisibility(enum.StrEnum):
    PUBLIC = "public"
    INTERNAL = "internal"


class PetitionAttachmentVisibility(enum.StrEnum):
    PUBLIC = "public"
    INTERNAL = "internal"


class PetitionType(Base, TimestampMixin):
    """陳情類型，由後台管理並指定預設負責機關。"""

    __tablename__ = "petition_types"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    responsible_org: Mapped[Org] = relationship("Org")
    cases: Mapped[list[PetitionCase]] = relationship("PetitionCase", back_populates="type")


class PetitionCase(Base, TimestampMixin):
    """陳情案件主表。"""

    __tablename__ = "petition_cases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_number: Mapped[str] = mapped_column(String(7), nullable=False, unique=True, index=True)
    verification_code_hash: Mapped[str] = mapped_column(String(128), nullable=False)

    type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("petition_types.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[PetitionStatus] = mapped_column(
        Enum(
            PetitionStatus,
            name="petitionstatus",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=PetitionStatus.SUBMITTED,
        index=True,
    )
    is_named: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    submitter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    contact_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    public_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    latest_internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    supplement_request: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    current_org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    type: Mapped[PetitionType] = relationship("PetitionType", back_populates="cases")
    current_org: Mapped[Org] = relationship("Org", foreign_keys=[current_org_id])
    submitter: Mapped[User | None] = relationship("User", foreign_keys=[submitter_id])
    assigned_to: Mapped[User | None] = relationship("User", foreign_keys=[assigned_to_id])
    events: Mapped[list[PetitionCaseEvent]] = relationship(
        "PetitionCaseEvent",
        back_populates="case",
        cascade="all, delete-orphan",
        order_by="PetitionCaseEvent.created_at",
    )
    attachments: Mapped[list[PetitionAttachment]] = relationship(
        "PetitionAttachment", back_populates="case", cascade="all, delete-orphan"
    )


class PetitionCaseEvent(Base, TimestampMixin):
    """陳情案件處理歷程。"""

    __tablename__ = "petition_case_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("petition_cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[PetitionEventType] = mapped_column(
        Enum(
            PetitionEventType,
            name="petitioneventtype",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        index=True,
    )
    visibility: Mapped[PetitionEventVisibility] = mapped_column(
        Enum(
            PetitionEventVisibility,
            name="petitioneventvisibility",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=PetitionEventVisibility.PUBLIC,
        index=True,
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    from_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True
    )
    to_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True
    )
    from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)

    case: Mapped[PetitionCase] = relationship("PetitionCase", back_populates="events")
    actor: Mapped[User | None] = relationship("User", foreign_keys=[actor_id])
    from_org: Mapped[Org | None] = relationship("Org", foreign_keys=[from_org_id])
    to_org: Mapped[Org | None] = relationship("Org", foreign_keys=[to_org_id])


class PetitionAttachment(Base, TimestampMixin):
    """陳情案件附件。"""

    __tablename__ = "petition_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("petition_cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    visibility: Mapped[PetitionAttachmentVisibility] = mapped_column(
        Enum(
            PetitionAttachmentVisibility,
            name="petitionattachmentvisibility",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=PetitionAttachmentVisibility.PUBLIC,
        index=True,
    )
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    case: Mapped[PetitionCase] = relationship("PetitionCase", back_populates="attachments")
    uploader: Mapped[User | None] = relationship("User")


__all__ = [
    "PetitionAttachment",
    "PetitionAttachmentVisibility",
    "PetitionCase",
    "PetitionCaseEvent",
    "PetitionEventType",
    "PetitionEventVisibility",
    "PetitionStatus",
    "PetitionType",
]
