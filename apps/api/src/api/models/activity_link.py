"""活動跨模組關聯。"""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict


class ActivityLinkKind(enum.StrEnum):
    ANNOUNCEMENT = "announcement"
    SURVEY = "survey"
    SHOP_PRODUCT = "shop_product"
    SHOP_ORDER = "shop_order"
    MEAL_SCHEDULE = "meal_schedule"
    MEAL_ORDER = "meal_order"
    MEETING = "meeting"
    CALENDAR_EVENT = "calendar_event"
    DOCUMENT = "document"
    REGULATION = "regulation"
    PETITION = "petition"
    COUNCIL_PROPOSAL = "council_proposal"
    JUDICIAL_PETITION = "judicial_petition"
    WORK_ITEM = "work_item"
    RECEIVABLE = "receivable"
    PUBLICATION = "publication"


class ActivityLink(Base, TimestampMixin):
    """把任一模組資料掛到活動工作區。"""

    __tablename__ = "activity_links"
    __table_args__ = (
        UniqueConstraint("activity_id", "target_type", "target_id", name="uq_activity_link_target"),
        Index("ix_activity_links_activity_type", "activity_id", "target_type"),
        Index("ix_activity_links_target", "target_type", "target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    href: Mapped[str] = mapped_column(String(500), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    activity = relationship("Activity")
    created_by = relationship("User")


__all__ = ["ActivityLink", "ActivityLinkKind"]
