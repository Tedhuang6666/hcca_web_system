"""共用應收款與對帳模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin


class ReceivableSource(enum.StrEnum):
    SHOP_ORDER = "shop_order"
    MEAL_ORDER = "meal_order"
    ACTIVITY_FEE = "activity_fee"
    CLASS_FEE = "class_fee"
    MANUAL = "manual"


class ReceivableStatus(enum.StrEnum):
    UNPAID = "unpaid"
    PARTIAL = "partial"
    PAID = "paid"
    REFUNDING = "refunding"
    REFUNDED = "refunded"
    CANCELED = "canceled"


class Receivable(Base, TimestampMixin):
    """一筆某人或某班應付款。"""

    __tablename__ = "receivables"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", name="uq_receivables_source"),
        Index("ix_receivables_activity_status", "activity_id", "status"),
        Index("ix_receivables_class_status", "class_id", "status"),
        Index("ix_receivables_user_status", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_classes.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paid_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    refunded_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ReceivableStatus.UNPAID, index=True
    )
    collected_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    activity = relationship("Activity")
    org = relationship("Org")
    user = relationship("User", foreign_keys=[user_id])
    collected_by = relationship("User", foreign_keys=[collected_by_id])
    school_class = relationship("SchoolClass")


__all__ = ["Receivable", "ReceivableSource", "ReceivableStatus"]
