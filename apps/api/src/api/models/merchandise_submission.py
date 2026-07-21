"""校商投稿 ORM 模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict, JSONList

if TYPE_CHECKING:
    from api.models.survey import Survey
    from api.models.user import User


class MerchandiseSubmissionStatus(enum.StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    REVIEWING = "reviewing"
    REVIEW_COMPLETED = "review_completed"
    APPROVED = "approved"
    REVISION_REQUESTED = "revision_requested"
    REJECTED = "rejected"


class MerchandiseSubmissionSettings(Base, TimestampMixin):
    """全站校商投稿設定；服務層會確保只有一筆設定。"""

    __tablename__ = "merchandise_submission_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    is_open: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_file_size_mb: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100, server_default="100"
    )
    require_school_email: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    announcement: Mapped[str | None] = mapped_column(Text, nullable=True)
    announcement_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    submission_intro: Mapped[str | None] = mapped_column(Text, nullable=True)
    global_fields: Mapped[list] = mapped_column(
        JSONList, nullable=False, default=list, server_default="[]"
    )
    show_announcement_popup: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    announcement_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("announcements.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class MerchandiseSubmissionItem(Base, TimestampMixin):
    """可投稿的校商品項與其個別規格。"""

    __tablename__ = "merchandise_submission_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_images: Mapped[list] = mapped_column(
        JSONList, nullable=False, default=list, server_default="[]"
    )
    custom_fields: Mapped[list] = mapped_column(
        JSONList, nullable=False, default=list, server_default="[]"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    is_open_override: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    opens_at_override: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closes_at_override: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    max_file_size_mb_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    submissions: Mapped[list[MerchandiseSubmission]] = relationship(
        "MerchandiseSubmission", back_populates="item", cascade="all, delete-orphan"
    )


class MerchandiseSubmission(Base, TimestampMixin):
    """學生對單一校商品項送出的作品。"""

    __tablename__ = "merchandise_submissions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("merchandise_submission_items.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[MerchandiseSubmissionStatus] = mapped_column(
        Enum(MerchandiseSubmissionStatus, name="merchandisesubmissionstatus"),
        nullable=False,
        default=MerchandiseSubmissionStatus.DRAFT,
        index=True,
    )
    account_snapshot: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    field_values: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    voting_survey_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("surveys.id", ondelete="SET NULL"), nullable=True, index=True
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    item: Mapped[MerchandiseSubmissionItem] = relationship(
        "MerchandiseSubmissionItem", back_populates="submissions"
    )
    user: Mapped[User] = relationship("User", foreign_keys=[user_id])
    reviewer: Mapped[User | None] = relationship("User", foreign_keys=[reviewer_id])
    voting_survey: Mapped[Survey | None] = relationship("Survey", foreign_keys=[voting_survey_id])
    files: Mapped[list[MerchandiseSubmissionFile]] = relationship(
        "MerchandiseSubmissionFile", back_populates="submission", cascade="all, delete-orphan"
    )


class MerchandiseSubmissionFile(Base, TimestampMixin):
    __tablename__ = "merchandise_submission_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("merchandise_submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)

    submission: Mapped[MerchandiseSubmission] = relationship(
        "MerchandiseSubmission", back_populates="files"
    )
