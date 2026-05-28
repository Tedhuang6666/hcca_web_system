"""Discord 帳號綁定與伺服器角色映射 ORM 模型。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org, Position
    from api.models.user import User


class DiscordRoleMappingKind(StrEnum):
    ORG = "org"
    POSITION = "position"


class DiscordAccountLink(Base, TimestampMixin):
    """平台使用者與 Discord user id 的一對一綁定。"""

    __tablename__ = "discord_account_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    discord_user_id: Mapped[str] = mapped_column(
        String(32), unique=True, nullable=False, index=True
    )
    username: Mapped[str | None] = mapped_column(String(100), nullable=True)
    global_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    avatar_hash: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    unlinked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User")


class DiscordGuildConfig(Base, TimestampMixin):
    """Discord guild 與平台辦公頻道設定。"""

    __tablename__ = "discord_guild_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guild_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    office_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    security_alert_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    petition_entry_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    announcement_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    admin_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)


class DiscordRoleMapping(Base, TimestampMixin):
    """平台組織/職位對應 Discord 身分組。"""

    __tablename__ = "discord_role_mappings"
    __table_args__ = (
        UniqueConstraint("guild_id", "role_id", name="uq_discord_role_mapping_role"),
        Index("ix_discord_role_mapping_target", "mapping_kind", "org_id", "position_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guild_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    role_id: Mapped[str] = mapped_column(String(32), nullable=False)
    mapping_kind: Mapped[DiscordRoleMappingKind] = mapped_column(String(20), nullable=False)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("positions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    org: Mapped[Org | None] = relationship("Org")
    position: Mapped[Position | None] = relationship("Position")


__all__ = [
    "DiscordAccountLink",
    "DiscordGuildConfig",
    "DiscordRoleMapping",
    "DiscordRoleMappingKind",
]
