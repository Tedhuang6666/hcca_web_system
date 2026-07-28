"""特約商家申請 ORM 模型。"""

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
from api.models.types import JSONDict, JSONList

if TYPE_CHECKING:
    from api.models.partner_map import PartnerBusiness
    from api.models.user import User


class PartnerApplicationFieldType(enum.StrEnum):
    TEXT = "text"
    TEXTAREA = "textarea"
    EMAIL = "email"
    TEL = "tel"
    URL = "url"
    SELECT = "select"


class PartnerBusinessApplicationStatus(enum.StrEnum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    NEEDS_INFO = "needs_info"
    REJECTED = "rejected"


class PartnerApplicationSettings(Base, TimestampMixin):
    """特約商家申請表單的全域設定。"""

    __tablename__ = "partner_application_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    is_open: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    title: Mapped[str] = mapped_column(
        String(200), nullable=False, default="申請成為特約商家", server_default="申請成為特約商家"
    )
    intro: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="留下合作資訊，班聯會會在收到申請後與您聯繫。",
        server_default="留下合作資訊，班聯會會在收到申請後與您聯繫。",
    )
    privacy_notice: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    fields: Mapped[list[PartnerApplicationField]] = relationship(
        "PartnerApplicationField",
        back_populates="settings",
        cascade="all, delete-orphan",
        order_by="PartnerApplicationField.sort_order",
    )
    updater: Mapped[User | None] = relationship("User", foreign_keys=[updated_by])


class PartnerApplicationField(Base, TimestampMixin):
    """申請表單的單一可配置欄位。"""

    __tablename__ = "partner_application_fields"
    __table_args__ = (
        UniqueConstraint("settings_id", "key", name="uq_partner_application_fields_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    settings_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("partner_application_settings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    key: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    field_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=PartnerApplicationFieldType.TEXT.value,
        server_default=PartnerApplicationFieldType.TEXT.value,
    )
    required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    placeholder: Mapped[str | None] = mapped_column(String(200), nullable=True)
    help_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    options: Mapped[list[str]] = mapped_column(JSONList, nullable=False, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    settings: Mapped[PartnerApplicationSettings] = relationship(
        "PartnerApplicationSettings", back_populates="fields"
    )


class PartnerBusinessApplication(Base, TimestampMixin):
    """公開送出的特約商家申請與審核紀錄。"""

    __tablename__ = "partner_business_applications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=PartnerBusinessApplicationStatus.PENDING.value,
        server_default=PartnerBusinessApplicationStatus.PENDING.value,
        index=True,
    )
    field_values: Mapped[dict[str, str]] = mapped_column(JSONDict, nullable=False, default=dict)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    business_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("partner_businesses.id", ondelete="SET NULL"), nullable=True
    )

    submitter: Mapped[User | None] = relationship("User", foreign_keys=[submitted_by])
    reviewer: Mapped[User | None] = relationship("User", foreign_keys=[reviewed_by])
    business: Mapped[PartnerBusiness | None] = relationship("PartnerBusiness")


__all__ = [
    "PartnerApplicationField",
    "PartnerApplicationFieldType",
    "PartnerApplicationSettings",
    "PartnerBusinessApplication",
    "PartnerBusinessApplicationStatus",
]
