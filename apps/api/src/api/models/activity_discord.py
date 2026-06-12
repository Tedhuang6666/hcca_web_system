"""活動職務、成員與 Discord 工作區模型。"""

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
    from api.models.activity import Activity
    from api.models.user import User


class DiscordActivitySyncStatus(enum.StrEnum):
    IDLE = "idle"
    PENDING = "pending"
    SYNCED = "synced"
    FAILED = "failed"
    ARCHIVED = "archived"


class ActivityRole(Base, TimestampMixin):
    """活動內職務，可各自對應 Discord 身分組與私有頻道。"""

    __tablename__ = "activity_roles"
    __table_args__ = (
        UniqueConstraint("activity_id", "key", name="uq_activity_role_key"),
        Index("ix_activity_roles_active", "activity_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    key: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    discord_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    discord_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    create_private_channel: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    sort_order: Mapped[int] = mapped_column(nullable=False, default=100, server_default="100")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    activity: Mapped[Activity] = relationship("Activity")
    members: Mapped[list[ActivityMember]] = relationship(
        "ActivityMember", back_populates="role", cascade="all, delete-orphan"
    )


class ActivityMember(Base, TimestampMixin):
    """活動職務任命紀錄。"""

    __tablename__ = "activity_members"
    __table_args__ = (
        UniqueConstraint(
            "activity_id", "role_id", "user_id", "start_date", name="uq_activity_member_term"
        ),
        Index("ix_activity_members_active", "activity_id", "user_id", "end_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activity_roles.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    role: Mapped[ActivityRole] = relationship("ActivityRole", back_populates="members")
    user: Mapped[User] = relationship("User")


class DiscordActivityWorkspace(Base, TimestampMixin):
    """單一活動在 Discord guild 內的完整工作區。"""

    __tablename__ = "discord_activity_workspaces"
    __table_args__ = (
        UniqueConstraint("activity_id", name="uq_discord_activity_workspace_activity"),
        Index("ix_discord_activity_workspace_guild", "guild_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    guild_id: Mapped[str] = mapped_column(String(32), nullable=False)
    category_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    general_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    announcement_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    staff_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    convener_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sync_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=DiscordActivitySyncStatus.IDLE
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auto_sync: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    activity: Mapped[Activity] = relationship("Activity")


__all__ = [
    "ActivityMember",
    "ActivityRole",
    "DiscordActivitySyncStatus",
    "DiscordActivityWorkspace",
]
