"""跨渠道發布中心模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict, JSONList


class PublicationStatus(enum.StrEnum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    SENT = "sent"
    CANCELED = "canceled"


class PublicationDeliveryStatus(enum.StrEnum):
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"
    READ = "read"
    CLICKED = "clicked"


class PublicationCampaign(Base, TimestampMixin):
    """一次核心內容、多渠道配送的發布任務。"""

    __tablename__ = "publication_campaigns"
    __table_args__ = (
        Index("ix_publication_campaigns_activity_status", "activity_id", "status"),
        Index("ix_publication_campaigns_source", "source_type", "source_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True
    )
    audience_type: Mapped[str] = mapped_column(String(50), nullable=False, default="all")
    audience_filter: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    channels: Mapped[list] = mapped_column(JSONList, nullable=False, default=list)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=PublicationStatus.DRAFT, index=True
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    activity = relationship("Activity")
    org = relationship("Org")
    created_by = relationship("User")
    deliveries = relationship(
        "PublicationDelivery", back_populates="campaign", cascade="all, delete-orphan"
    )


class PublicationDelivery(Base, TimestampMixin):
    """單一渠道或單一收件者配送結果。"""

    __tablename__ = "publication_deliveries"
    __table_args__ = (
        Index("ix_publication_deliveries_campaign_channel", "campaign_id", "channel"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("publication_campaigns.id", ondelete="CASCADE")
    )
    channel: Mapped[str] = mapped_column(String(30), nullable=False)
    recipient_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,  # 依收件者反查投遞紀錄會用到，保留索引
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=PublicationDeliveryStatus.QUEUED, index=True
    )
    target: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    clicked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    campaign = relationship("PublicationCampaign", back_populates="deliveries")
    recipient_user = relationship("User")


__all__ = [
    "PublicationCampaign",
    "PublicationDelivery",
    "PublicationDeliveryStatus",
    "PublicationStatus",
]
