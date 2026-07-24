"""可配置的 Discord 模組事件通知路由。"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.petition import PetitionType


class DiscordNotificationRoute(Base, TimestampMixin):
    """將模組事件依條件送到指定 Discord 頻道，可選擇標註身分組。"""

    __tablename__ = "discord_notification_routes"
    __table_args__ = (
        Index("ix_discord_notification_route_event_active", "event_key", "is_active"),
        Index("ix_discord_notification_route_filters", "petition_type_id", "org_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guild_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    event_key: Mapped[str] = mapped_column(String(80), nullable=False)
    module: Mapped[str] = mapped_column(String(40), nullable=False)
    channel_id: Mapped[str] = mapped_column(String(32), nullable=False)
    role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    petition_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("petition_types.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    priority: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100, server_default="100"
    )
    mention_role: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    petition_type: Mapped[PetitionType | None] = relationship("PetitionType")
    org: Mapped[Org | None] = relationship("Org")


__all__ = ["DiscordNotificationRoute"]
