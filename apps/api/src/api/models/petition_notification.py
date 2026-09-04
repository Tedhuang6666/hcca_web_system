"""陳情負責人通知規則 ORM 模型。"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import expression

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONList


class PetitionNotificationSettings(Base, TimestampMixin):
    """陳情全域通知設定；服務層確保實際使用單一設定。"""

    __tablename__ = "petition_notification_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=expression.true()
    )
    recipient_user_ids: Mapped[list[Any]] = mapped_column(
        JSONList, nullable=False, default=list, server_default="[]"
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class PetitionNotificationRule(Base, TimestampMixin):
    """依陳情類型或負責機關覆寫全域通知設定。"""

    __tablename__ = "petition_notification_rules"
    __table_args__ = (
        CheckConstraint(
            "(petition_type_id IS NOT NULL) <> (org_id IS NOT NULL)",
            name="ck_petition_notification_rule_one_scope",
        ),
        UniqueConstraint("petition_type_id", name="uq_petition_notification_rule_type"),
        UniqueConstraint("org_id", name="uq_petition_notification_rule_org"),
        Index("ix_petition_notification_rules_type", "petition_type_id"),
        Index("ix_petition_notification_rules_org", "org_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    petition_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("petition_types.id", ondelete="CASCADE"),
        nullable=True,
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=expression.true()
    )
    recipient_user_ids: Mapped[list[Any]] = mapped_column(
        JSONList, nullable=False, default=list, server_default="[]"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=expression.true()
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
