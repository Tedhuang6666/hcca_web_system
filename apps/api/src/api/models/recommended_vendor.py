"""推薦商家 ORM 模型 - 通過衛生檢驗的校園周邊商家與選填商品資訊。"""

from __future__ import annotations

import enum
import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class RecommendedVendorStatus(enum.StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    HIDDEN = "hidden"
    ARCHIVED = "archived"


class RecommendedVendor(Base, TimestampMixin):
    """推薦商家主資料；只有檢驗有效且 active 的資料會出現在學生端。"""

    __tablename__ = "recommended_vendors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    summary: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    google_maps_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    business_hours_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    line_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    social_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    website_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordering_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    menu_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    hygiene_inspection_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    hygiene_inspection_expires_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    hygiene_certificate_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    hygiene_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=RecommendedVendorStatus.DRAFT.value,
        server_default=RecommendedVendorStatus.DRAFT.value,
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    creator: Mapped[User | None] = relationship("User")
    products: Mapped[list[RecommendedVendorProduct]] = relationship(
        "RecommendedVendorProduct",
        back_populates="vendor",
        cascade="all, delete-orphan",
        order_by="RecommendedVendorProduct.sort_order",
    )


class RecommendedVendorProduct(Base, TimestampMixin):
    """商家提供的選填菜單／商品資訊。"""

    __tablename__ = "recommended_vendor_products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recommended_vendors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price_text: Mapped[str | None] = mapped_column(String(80), nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    menu_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    vendor: Mapped[RecommendedVendor] = relationship(
        "RecommendedVendor", back_populates="products"
    )


__all__ = ["RecommendedVendor", "RecommendedVendorProduct", "RecommendedVendorStatus"]
