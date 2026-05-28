"""Defense rules for DB-backed manual traffic controls."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict


class DefenseRuleType(StrEnum):
    IP_BLOCK = "ip_block"
    CIDR_BLOCK = "cidr_block"
    IP_ALLOW = "ip_allow"
    RATE_LIMIT_OVERRIDE = "rate_limit_override"
    ENDPOINT_LOCKDOWN = "endpoint_lockdown"
    BOT_CHALLENGE_PLACEHOLDER = "bot_challenge_placeholder"


class DefenseRule(Base, TimestampMixin):
    """Long-lived manual defense rule.

    Middleware reads a Redis projection of active rules; the database remains
    the source of truth for admin review and auditability.
    """

    __tablename__ = "defense_rules"
    __table_args__ = (
        Index("ix_defense_rules_type_target", "rule_type", "target"),
        Index("ix_defense_rules_active", "is_active"),
        Index("ix_defense_rules_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    config: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


__all__ = ["DefenseRule", "DefenseRuleType"]
