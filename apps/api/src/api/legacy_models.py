"""已停用功能的 ORM metadata，供 Alembic 比對既有資料表。

這些模型不會被 API/Celery 的一般 import 載入，也不會重新掛回任何路由；
保留它們是為了讓既有資料庫表在 schema drift 檢查中有對應的 metadata。
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict, JSONList

if TYPE_CHECKING:
    from api.models.activity import Activity
    from api.models.loan import LoanItemCategory
    from api.models.org import Org
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


class InventoryItemType(enum.StrEnum):
    CONSUMABLE = "consumable"  # 消耗品（紙張、電池等）
    EQUIPMENT = "equipment"  # 設備（延長線、麥克風等）
    LOANABLE = "loanable"  # 可借用物品（連結借用模組）


class InventoryTxnType(enum.StrEnum):
    INITIAL = "initial"  # 期初建帳
    IN = "in"  # 進貨/補充
    OUT = "out"  # 耗用/發放
    ADJUSTMENT = "adjustment"  # 盤點調整
    DAMAGED = "damaged"  # 損耗
    LOST = "lost"  # 遺失


class InventoryProcurementStatus(enum.StrEnum):
    DRAFT = "draft"  # 草稿
    SUBMITTED = "submitted"  # 已提交待審
    APPROVED = "approved"  # 已核准
    REJECTED = "rejected"  # 已駁回
    RECEIVED = "received"  # 已收貨入庫


class InventoryCategory(Base, TimestampMixin):
    """物資類別，如「辦公耗材」、「音響設備」。"""

    __tablename__ = "inventory_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)  # #RRGGBB
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    org: Mapped[Org] = relationship("Org")
    items: Mapped[list[InventoryItem]] = relationship(
        "InventoryItem", back_populates="category", cascade="all, delete-orphan"
    )


class InventoryItem(Base, TimestampMixin):
    """物資品項主表。"""

    __tablename__ = "inventory_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="個")
    item_type: Mapped[InventoryItemType] = mapped_column(
        String(20), nullable=False, default=InventoryItemType.CONSUMABLE, index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    # 可選連結至借用模組的物品類型（loanable 時使用）
    loan_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_item_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    org: Mapped[Org] = relationship("Org")
    category: Mapped[InventoryCategory | None] = relationship(
        "InventoryCategory", back_populates="items"
    )
    loan_item: Mapped[LoanItemCategory | None] = relationship("LoanItemCategory")
    transactions: Mapped[list[InventoryTransaction]] = relationship(
        "InventoryTransaction", back_populates="item", cascade="all, delete-orphan"
    )

    @property
    def is_low_stock(self) -> bool:
        return self.low_stock_threshold > 0 and self.quantity <= self.low_stock_threshold


class InventoryTransaction(Base, TimestampMixin):
    """庫存異動日誌，每次庫存變動都留下稽核紀錄。"""

    __tablename__ = "inventory_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    txn_type: Mapped[InventoryTxnType] = mapped_column(String(20), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)  # delta（正=入庫，負=出庫）
    quantity_before: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_after: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    item: Mapped[InventoryItem] = relationship("InventoryItem", back_populates="transactions")
    created_by: Mapped[User | None] = relationship("User")


class InventoryProcurement(Base, TimestampMixin):
    """採購申請主表。"""

    __tablename__ = "inventory_procurements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[InventoryProcurementStatus] = mapped_column(
        String(20), nullable=False, default=InventoryProcurementStatus.DRAFT, index=True
    )
    estimated_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requester_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requester_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    org: Mapped[Org] = relationship("Org")
    requester: Mapped[User] = relationship("User", foreign_keys=[requester_id])
    reviewer: Mapped[User | None] = relationship("User", foreign_keys=[reviewer_id])
    line_items: Mapped[list[InventoryProcurementItem]] = relationship(
        "InventoryProcurementItem", back_populates="procurement", cascade="all, delete-orphan"
    )


class InventoryProcurementItem(Base, TimestampMixin):
    """採購申請明細。"""

    __tablename__ = "inventory_procurement_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    procurement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_procurements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 可空：採購新品項時尚未在系統建立
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    item_unit: Mapped[str] = mapped_column(String(20), nullable=False, default="個")
    quantity_requested: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_received: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_unit_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    procurement: Mapped[InventoryProcurement] = relationship(
        "InventoryProcurement", back_populates="line_items"
    )
    item: Mapped[InventoryItem | None] = relationship("InventoryItem")


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
