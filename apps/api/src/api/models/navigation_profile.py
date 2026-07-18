"""角色視角導覽設定 ORM 模型。"""

from __future__ import annotations

import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin


class NavigationProfile(Base, TimestampMixin):
    """登入後導覽與工作台視角。"""

    __tablename__ = "navigation_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    audience: Mapped[str | None] = mapped_column(String(200), nullable=True)
    priority: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100, server_default="100"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    match_any_permissions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    match_any_prefixes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    exclude_permissions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    exclude_prefixes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    desktop_sections: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    mobile_order: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    positions: Mapped[list[NavigationProfilePosition]] = relationship(
        "NavigationProfilePosition",
        back_populates="profile",
        cascade="all, delete-orphan",
    )


class NavigationProfilePosition(Base):
    """指定職位套用某個視角。"""

    __tablename__ = "navigation_profile_positions"
    __table_args__ = (
        UniqueConstraint("profile_id", "position_id", name="uq_navigation_profile_position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("navigation_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("positions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    profile: Mapped[NavigationProfile] = relationship(
        "NavigationProfile",
        back_populates="positions",
    )
