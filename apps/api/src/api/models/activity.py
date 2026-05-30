"""活動 ORM 模型 - Activity / ActivityConvener"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.user import User


class ActivityStatus(enum.StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    ENDED = "ended"
    ARCHIVED = "archived"


class Activity(Base, TimestampMixin):
    """活動主檔；可隸屬既有組織，也可獨立存在。"""

    __tablename__ = "activities"
    __table_args__ = (
        Index("ix_activities_org_status", "org_id", "status"),
        Index("ix_activities_active_status", "is_active", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ActivityStatus.DRAFT, index=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    org: Mapped[Org | None] = relationship("Org")
    conveners: Mapped[list[ActivityConvener]] = relationship(
        "ActivityConvener", back_populates="activity", cascade="all, delete-orphan"
    )


class ActivityConvener(Base, TimestampMixin):
    """活動總召任命紀錄。"""

    __tablename__ = "activity_conveners"
    __table_args__ = (
        UniqueConstraint("activity_id", "user_id", "start_date", name="uq_activity_convener_term"),
        Index("ix_activity_conveners_active", "activity_id", "user_id", "end_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    activity: Mapped[Activity] = relationship("Activity", back_populates="conveners")
    user: Mapped[User] = relationship("User")


__all__ = ["Activity", "ActivityConvener", "ActivityStatus"]
