"""物品借用系統：物品類型、個體、借用紀錄。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.user import User


class LoanUnitStatus(enum.StrEnum):
    AVAILABLE = "available"
    BORROWED = "borrowed"
    LOST = "lost"
    DAMAGED = "damaged"
    RETIRED = "retired"


class LoanRecordStatus(enum.StrEnum):
    ACTIVE = "active"
    RETURNED = "returned"
    OVERDUE = "overdue"
    LOST = "lost"


class LoanItemCategory(Base, TimestampMixin):
    """物品類型，如「雨傘」、「延長線」。"""

    __tablename__ = "loan_item_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    default_due_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)

    org: Mapped[Org] = relationship("Org")
    units: Mapped[list[LoanUnit]] = relationship(
        "LoanUnit", back_populates="item", cascade="all, delete-orphan"
    )


class LoanUnit(Base, TimestampMixin):
    """物品個體，每個實際物品有唯一人工編號。"""

    __tablename__ = "loan_units"
    __table_args__ = (
        UniqueConstraint("item_id", "unit_code", name="uq_loan_unit_code_per_item"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_item_categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    unit_code: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[LoanUnitStatus] = mapped_column(
        String(20), nullable=False, default=LoanUnitStatus.AVAILABLE, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    item: Mapped[LoanItemCategory] = relationship("LoanItemCategory", back_populates="units")
    records: Mapped[list[LoanRecord]] = relationship("LoanRecord", back_populates="unit")


class LoanRecord(Base, TimestampMixin):
    """借用紀錄，每次借出一個個體。"""

    __tablename__ = "loan_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_units.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    borrower_name: Mapped[str] = mapped_column(String(100), nullable=False)
    borrower_student_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    borrower_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    borrower_contact: Mapped[str | None] = mapped_column(String(50), nullable=True)
    borrowed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[LoanRecordStatus] = mapped_column(
        String(20), nullable=False, default=LoanRecordStatus.ACTIVE, index=True
    )
    reminder_sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    handled_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    return_handled_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    unit: Mapped[LoanUnit] = relationship("LoanUnit", back_populates="records")
    handled_by: Mapped[User | None] = relationship("User", foreign_keys=[handled_by_id])
    return_handled_by: Mapped[User | None] = relationship(
        "User", foreign_keys=[return_handled_by_id]
    )
