"""客服作業平台資料模型。

客服資料與一般管理資料分表，讓工單、核准與客服操作可以獨立保存、查詢與
設定保存期限。客服稽核表只新增不刪改；一般操作仍同步寫入既有 AuditLog 雜湊鏈。
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict, JSONList


class SupportTicketStatus(enum.StrEnum):
    NEW = "new"
    ASSIGNED = "assigned"
    INVESTIGATING = "investigating"
    WAITING_USER = "waiting_user"
    WAITING_INTERNAL = "waiting_internal"
    RESOLVED = "resolved"
    CLOSED = "closed"
    REOPENED = "reopened"


class SupportTicketPriority(enum.StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class SupportApprovalStatus(enum.StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXECUTED = "executed"
    CANCELED = "canceled"


class SupportAssistanceStatus(enum.StrEnum):
    WAITING = "waiting"
    ACTIVE = "active"
    EXPIRED = "expired"
    CLOSED = "closed"


class SupportImpersonationMode(enum.StrEnum):
    READ_ONLY = "read_only"
    INTERACTIVE = "interactive"


class SupportTicket(Base, TimestampMixin):
    __tablename__ = "support_tickets"
    __table_args__ = (
        Index("ix_support_tickets_ticket_number", "ticket_number"),
        Index("ix_support_tickets_status_priority", "status", "priority"),
        Index("ix_support_tickets_user_status", "user_id", "status"),
        Index("ix_support_tickets_request_id", "request_id"),
        Index("ix_support_tickets_error_code", "error_code"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reported_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default="internal")
    priority: Mapped[SupportTicketPriority] = mapped_column(
        String(16), nullable=False, default=SupportTicketPriority.NORMAL, index=True
    )
    status: Mapped[SupportTicketStatus] = mapped_column(
        String(24), nullable=False, default=SupportTicketStatus.NEW, index=True
    )
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    related_data: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    events: Mapped[list[SupportTicketEvent]] = relationship(
        "SupportTicketEvent", back_populates="ticket", cascade="all, delete-orphan"
    )


class SupportTicketEvent(Base):
    __tablename__ = "support_ticket_events"
    __table_args__ = (Index("ix_support_ticket_events_ticket_created", "ticket_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # `metadata` is reserved by SQLAlchemy's declarative base; map the SQL name
    # explicitly while keeping a safe application-side attribute.
    event_metadata: Mapped[dict] = mapped_column("metadata", JSONDict, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )

    ticket: Mapped[SupportTicket] = relationship("SupportTicket", back_populates="events")


class SupportAuditLog(Base):
    """客服專用 append-only 稽核表。應用程式不提供 UPDATE/DELETE 路由。"""

    __tablename__ = "support_audit_logs"
    __table_args__ = (
        Index("ix_support_audit_actor_created", "actor_user_id", "created_at"),
        Index("ix_support_audit_target_created", "target_user_id", "created_at"),
        Index("ix_support_audit_ticket_created", "ticket_id", "created_at"),
        Index("ix_support_audit_action", "action"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("support_tickets.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    before_data: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)
    after_data: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )


class SupportApproval(Base):
    __tablename__ = "support_approvals"
    __table_args__ = (
        Index("ix_support_approvals_approval_number", "approval_number"),
        Index("ix_support_approvals_status_requested", "status", "requested_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    approval_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    requested_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("support_tickets.id", ondelete="SET NULL"), nullable=True
    )
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONDict, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default="high")
    status: Mapped[SupportApprovalStatus] = mapped_column(
        String(16), nullable=False, default=SupportApprovalStatus.PENDING, index=True
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)


class SupportImpersonationSession(Base):
    __tablename__ = "support_impersonation_sessions"
    __table_args__ = (
        Index("ix_support_impersonation_token_hash", "token_hash"),
        Index("ix_support_impersonation_target_expires", "impersonated_user_id", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    real_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    impersonated_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("support_tickets.id", ondelete="RESTRICT"), nullable=False
    )
    mode: Mapped[SupportImpersonationMode] = mapped_column(
        String(16), nullable=False, default=SupportImpersonationMode.READ_ONLY
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )


class SupportAssistanceSession(Base):
    __tablename__ = "support_assistance_sessions"
    __table_args__ = (
        Index("ix_support_assistance_assistance_code", "assistance_code"),
        Index("ix_support_assistance_status", "status"),
        Index("ix_support_assistance_target_status", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assistance_code: Mapped[str] = mapped_column(String(6), unique=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    support_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("support_tickets.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[SupportAssistanceStatus] = mapped_column(
        String(16), nullable=False, default=SupportAssistanceStatus.WAITING
    )
    current_route: Mapped[str | None] = mapped_column(String(512), nullable=True)
    client_state: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )


class SupportGuideEntry(Base, TimestampMixin):
    __tablename__ = "support_guide_entries"
    __table_args__ = (Index("ix_support_guide_entries_slug", "slug"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="general")
    required_permissions: Mapped[list] = mapped_column(JSONList, nullable=False, default=list)
    route: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


__all__ = [
    "SupportApproval",
    "SupportApprovalStatus",
    "SupportAssistanceSession",
    "SupportAssistanceStatus",
    "SupportAuditLog",
    "SupportGuideEntry",
    "SupportImpersonationMode",
    "SupportImpersonationSession",
    "SupportTicket",
    "SupportTicketEvent",
    "SupportTicketPriority",
    "SupportTicketStatus",
]
