"""Discord 帳號綁定與伺服器角色映射 ORM 模型。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict, JSONList

DEFAULT_DM_CATEGORIES: dict[str, bool] = {
    "document_pending": True,
    "meeting_invited": True,
    "calendar_reminder": True,
    "meal_closing": True,
    "survey_closing": True,
    "shop_ready": True,
    "tenure": True,
    "regulation": False,
    "announcement_dm": False,
    "petition_assigned": True,
}

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
    petition_private_category_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    petition_staff_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    petition_private_channel_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    announcement_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    moderation_log_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    welcome_channel_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
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


class DiscordOrgChannelMapping(Base, TimestampMixin):
    """平台機關對應 Discord 公告頻道。"""

    __tablename__ = "discord_org_channel_mappings"
    __table_args__ = (
        UniqueConstraint("guild_id", "org_id", name="uq_discord_org_channel_mapping_org"),
        Index("ix_discord_org_channel_mapping_active", "guild_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guild_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    channel_id: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    org: Mapped[Org] = relationship("Org")


class DiscordNicknamePrefixRule(Base, TimestampMixin):
    """平台組織/職位對應 Discord 社群暱稱前綴。"""

    __tablename__ = "discord_nickname_prefix_rules"
    __table_args__ = (
        Index("ix_discord_nickname_prefix_rule_target", "mapping_kind", "org_id", "position_id"),
        Index("ix_discord_nickname_prefix_rule_active", "guild_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guild_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    priority: Mapped[int] = mapped_column(nullable=False, default=100, index=True)
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


class DiscordRolePolicy(Base, TimestampMixin):
    """Discord 身分組的治理映射、暱稱標籤與同步政策。"""

    __tablename__ = "discord_role_policies"
    __table_args__ = (
        UniqueConstraint("guild_id", "role_id", name="uq_discord_role_policy_role"),
        Index("ix_discord_role_policy_target", "org_id", "position_id"),
        Index("ix_discord_role_policy_active", "guild_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guild_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    role_id: Mapped[str] = mapped_column(String(32), nullable=False)
    role_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("positions.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    nickname_label: Mapped[str | None] = mapped_column(String(20), nullable=True)
    priority: Mapped[int] = mapped_column(nullable=False, default=100, index=True)
    manage_role: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    use_in_nickname: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    org: Mapped[Org | None] = relationship("Org")
    position: Mapped[Position | None] = relationship("Position")


class DiscordMemberSyncState(Base, TimestampMixin):
    """保存成員 Discord 實際狀態、暱稱基線與平台差異。"""

    __tablename__ = "discord_member_sync_states"
    __table_args__ = (
        UniqueConstraint("guild_id", "discord_user_id", name="uq_discord_member_sync_state_member"),
        Index("ix_discord_member_sync_state_drift", "guild_id", "has_role_drift"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guild_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    discord_user_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    base_nickname: Mapped[str | None] = mapped_column(String(100), nullable=True)
    actual_nickname: Mapped[str | None] = mapped_column(String(100), nullable=True)
    expected_nickname: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_applied_prefix: Mapped[str | None] = mapped_column(String(50), nullable=True)
    actual_role_ids: Mapped[list] = mapped_column(
        JSONList, nullable=False, default=list, server_default="[]"
    )
    desired_role_ids: Mapped[list] = mapped_column(
        JSONList, nullable=False, default=list, server_default="[]"
    )
    has_role_drift: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    user: Mapped[User | None] = relationship("User")


class DiscordNotificationPreference(Base, TimestampMixin):
    """使用者個人 Discord 通知偏好。預設所有 category True；可用 /notify 在 Discord 內調整。"""

    __tablename__ = "discord_notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # 以 JSONB 存 {category: bool}，未列出視為 True（預設訂閱）
    preferences: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    # 「免打擾」時段（台北時區）。落在此區間的 DM 會被靜默捨棄並計入 metrics
    quiet_hours_start: Mapped[time | None] = mapped_column(Time, nullable=True)
    quiet_hours_end: Mapped[time | None] = mapped_column(Time, nullable=True)
    digest_daily_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    digest_weekly_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, default="Asia/Taipei", server_default="Asia/Taipei"
    )


__all__ = [
    "DEFAULT_DM_CATEGORIES",
    "DiscordAccountLink",
    "DiscordGuildConfig",
    "DiscordMemberSyncState",
    "DiscordNicknamePrefixRule",
    "DiscordNotificationPreference",
    "DiscordOrgChannelMapping",
    "DiscordRolePolicy",
    "DiscordRoleMapping",
    "DiscordRoleMappingKind",
]
