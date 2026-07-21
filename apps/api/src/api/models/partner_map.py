"""特約地圖 ORM 模型 - 店家 / 分店點位 / 標籤 / 優惠"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.user import User


class PartnerBusinessStatus(enum.StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    HIDDEN = "hidden"
    ARCHIVED = "archived"


class PartnerBusinessListingType(enum.StrEnum):
    """特約刊登方式：地圖點位或僅提供聯絡方式。"""

    LOCATION = "location"
    CONTACT = "contact"


class PartnerSubmissionStatus(enum.StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


partner_business_tags = Table(
    "partner_business_tags",
    Base.metadata,
    Column(
        "business_id",
        UUID(as_uuid=True),
        ForeignKey("partner_businesses.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        UUID(as_uuid=True),
        ForeignKey("partner_tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class PartnerTag(Base, TimestampMixin):
    """特約店家標籤，例如餐飲、飲料、文具、醫療、校園周邊。"""

    __tablename__ = "partner_tags"
    __table_args__ = (UniqueConstraint("name", name="uq_partner_tags_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    businesses: Mapped[list[PartnerBusiness]] = relationship(
        "PartnerBusiness", secondary=partner_business_tags, back_populates="tags"
    )


class PartnerBusiness(Base, TimestampMixin):
    """特約店家主資料。"""

    __tablename__ = "partner_businesses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    summary: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    website_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    social_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    business_hours_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    listing_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=PartnerBusinessListingType.LOCATION.value,
        server_default=PartnerBusinessListingType.LOCATION.value,
        index=True,
    )
    contact_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    instagram_handle: Mapped[str | None] = mapped_column(String(100), nullable=True)
    line_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    other_contact: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=PartnerBusinessStatus.DRAFT.value, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    click_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    checkin_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    creator: Mapped[User | None] = relationship("User")
    tags: Mapped[list[PartnerTag]] = relationship(
        "PartnerTag", secondary=partner_business_tags, back_populates="businesses"
    )
    locations: Mapped[list[PartnerLocation]] = relationship(
        "PartnerLocation",
        back_populates="business",
        cascade="all, delete-orphan",
        order_by="PartnerLocation.sort_order",
    )
    offers: Mapped[list[PartnerOffer]] = relationship(
        "PartnerOffer",
        back_populates="business",
        cascade="all, delete-orphan",
        order_by="PartnerOffer.sort_order",
    )
    ratings: Mapped[list[PartnerRating]] = relationship(
        "PartnerRating", back_populates="business", cascade="all, delete-orphan"
    )


class PartnerLocation(Base, TimestampMixin):
    """特約店家的實體分店或點位。"""

    __tablename__ = "partner_locations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("partner_businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address: Mapped[str] = mapped_column(String(300), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    longitude: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    business_hours: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    google_place_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    business: Mapped[PartnerBusiness] = relationship("PartnerBusiness", back_populates="locations")


class PartnerOffer(Base, TimestampMixin):
    """特約優惠方案。"""

    __tablename__ = "partner_offers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("partner_businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    public_summary: Mapped[str | None] = mapped_column(String(300), nullable=True)
    full_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    member_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    business: Mapped[PartnerBusiness] = relationship("PartnerBusiness", back_populates="offers")


class PartnerRating(Base, TimestampMixin):
    """學生對特約店家的評價。"""

    __tablename__ = "partner_ratings"
    __table_args__ = (UniqueConstraint("business_id", "user_id", name="uq_partner_rating_user"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("partner_businesses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    visit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    is_public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    business: Mapped[PartnerBusiness] = relationship("PartnerBusiness", back_populates="ratings")
    user: Mapped[User | None] = relationship("User")


class PartnerSubmission(Base, TimestampMixin):
    """學生投稿的新特約店家候選。"""

    __tablename__ = "partner_submissions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    offer_hint: Mapped[str | None] = mapped_column(String(300), nullable=True)
    contact_hint: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=PartnerSubmissionStatus.PENDING.value, index=True
    )
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
    "PartnerBusiness",
    "PartnerBusinessListingType",
    "PartnerBusinessStatus",
    "PartnerLocation",
    "PartnerOffer",
    "PartnerRating",
    "PartnerTag",
    "PartnerSubmission",
    "PartnerSubmissionStatus",
    "partner_business_tags",
]
