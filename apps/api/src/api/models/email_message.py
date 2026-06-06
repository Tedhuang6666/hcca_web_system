"""平台寄信紀錄 ORM 模型 — 承載草稿 / 預約 / 已寄 / 失敗的所有狀態。

同一張表兼任：寄信稽核軌跡、草稿暫存、預約寄送佇列、每日配額計算來源。
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.user import User


class EmailStatus(enum.StrEnum):
    """寄信生命週期狀態。"""

    DRAFT = "draft"  # 草稿，尚未送出
    SCHEDULED = "scheduled"  # 已排程，等待預約時間
    QUEUED = "queued"  # 已解析收件人並排入 Celery 寄送佇列
    SENT = "sent"  # 已送出
    FAILED = "failed"  # 解析或寄送失敗
    RETRYING = "retrying"  # 寄送失敗、退避中等待下一次重試
    DEAD = "dead"  # 超過重試上限，進入 dead-letter（不再自動重試）
    PARTIAL = "partial"  # 部分收件人已送出、部分失敗
    CANCELLED = "cancelled"  # 已取消（取消預約 / 刪除）


class EmailRecipientStatus(enum.StrEnum):
    """大量寄送時單一收件人的寄送狀態。"""

    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"
    RETRYING = "retrying"  # 退避中等待下一次重試
    DEAD = "dead"  # 超過重試上限，進入 dead-letter


class EmailResourceVisibility(enum.StrEnum):
    PRIVATE = "private"
    ORG = "org"


class EmailAttachmentMode(enum.StrEnum):
    ATTACHMENT = "attachment"
    LINK = "link"


class EmailEventType(enum.StrEnum):
    QUEUED = "queued"
    DELIVERED = "delivered"
    BOUNCED = "bounced"
    COMPLAINED = "complained"
    OPENED = "opened"
    CLICKED = "clicked"


class EmailMessage(Base, TimestampMixin):
    """一次「平台寄信」的紀錄。"""

    __tablename__ = "email_messages"
    __table_args__ = (
        Index("ix_email_messages_status_scheduled", "status", "scheduled_at"),
        Index("ix_email_messages_sender_created", "sender_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 寄件者；使用者刪除後保留紀錄（稽核），故 SET NULL
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    # 富文本 HTML 內文（清洗前原文，供草稿續編與稽核）
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 使用的範本名稱（v1 主要為 "generic"）
    template: Mapped[str] = mapped_column(String(50), nullable=False, default="generic")
    # 範本變數快照（標題 / 重點卡片列 / CTA 等）
    context: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    # 收件條件快照（user_ids / position_ids / org_ids / include_all）
    recipient_spec: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    # 自訂佔位符定義（key / label / required / default_value）
    variable_definitions: Mapped[list] = mapped_column(JSONDict, nullable=False, default=list)
    # 全 Campaign 共用預設變數，會被每位收件人的 variables 覆蓋
    default_variables: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    # 建立時匯入的逐收件人變數快照，供草稿續編與預約寄送使用
    recipient_variables: Mapped[list] = mapped_column(JSONDict, nullable=False, default=list)
    # 寄送時解析後去重的 email 清單（稽核關鍵欄位）
    resolved_emails: Mapped[list] = mapped_column(JSONDict, nullable=False, default=list)
    recipient_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=EmailStatus.DRAFT)
    # 預約寄送時間（status=SCHEDULED 時使用）
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 重試簿記：已嘗試次數與下一次重試時間（retry/dead-letter 用）
    attempt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    track_opens: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    track_clicks: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    idempotency_key: Mapped[str | None] = mapped_column(
        String(100), nullable=True, unique=True, index=True
    )

    sender: Mapped[User | None] = relationship("User", lazy="select")
    recipients: Mapped[list[EmailCampaignRecipient]] = relationship(
        "EmailCampaignRecipient",
        back_populates="message",
        lazy="select",
        cascade="all, delete-orphan",
    )
    attachments: Mapped[list[EmailAttachment]] = relationship(
        "EmailAttachment", back_populates="message", lazy="select", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<EmailMessage id={self.id} status={self.status} count={self.recipient_count}>"


class EmailCampaignRecipient(Base, TimestampMixin):
    """一次大量寄送中的單一收件人與其個人化變數。"""

    __tablename__ = "email_campaign_recipients"
    __table_args__ = (
        Index("ix_email_campaign_recipients_message_status", "message_id", "status"),
        Index("ix_email_campaign_recipients_email", "email"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    variables: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=EmailRecipientStatus.QUEUED
    )
    celery_task_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 重試簿記：已嘗試次數與下一次重試時間（retry/dead-letter 用）
    attempt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_clicked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_clicked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bounced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    complained_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    message: Mapped[EmailMessage] = relationship(
        "EmailMessage", back_populates="recipients", lazy="select"
    )
    user: Mapped[User | None] = relationship("User", lazy="select")
    events: Mapped[list[EmailRecipientEvent]] = relationship(
        "EmailRecipientEvent",
        back_populates="recipient",
        lazy="select",
        cascade="all, delete-orphan",
    )


class EmailTemplate(Base, TimestampMixin):
    __tablename__ = "email_templates"
    __table_args__ = (
        Index("ix_email_templates_owner_updated", "owner_id", "updated_at"),
        Index("ix_email_templates_org_active", "org_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, default=EmailResourceVisibility.PRIVATE
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    content: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    variable_definitions: Mapped[list] = mapped_column(JSONDict, nullable=False, default=list)
    is_favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    versions: Mapped[list[EmailTemplateVersion]] = relationship(
        "EmailTemplateVersion",
        back_populates="template",
        lazy="select",
        cascade="all, delete-orphan",
    )
    attachments: Mapped[list[EmailAttachment]] = relationship(
        "EmailAttachment", back_populates="template", lazy="select"
    )


class EmailTemplateVersion(Base, TimestampMixin):
    __tablename__ = "email_template_versions"
    __table_args__ = (UniqueConstraint("template_id", "version", name="uq_email_template_version"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    variable_definitions: Mapped[list] = mapped_column(JSONDict, nullable=False, default=list)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    template: Mapped[EmailTemplate] = relationship(
        "EmailTemplate", back_populates="versions", lazy="select"
    )


class EmailRecipientList(Base, TimestampMixin):
    __tablename__ = "email_recipient_lists"
    __table_args__ = (
        Index("ix_email_recipient_lists_owner_updated", "owner_id", "updated_at"),
        Index("ix_email_recipient_lists_org_active", "org_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, default=EmailResourceVisibility.PRIVATE
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    recipient_spec: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    variable_definitions: Mapped[list] = mapped_column(JSONDict, nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    members: Mapped[list[EmailRecipientListMember]] = relationship(
        "EmailRecipientListMember",
        back_populates="recipient_list",
        lazy="select",
        cascade="all, delete-orphan",
    )


class EmailRecipientListMember(Base, TimestampMixin):
    __tablename__ = "email_recipient_list_members"
    __table_args__ = (UniqueConstraint("list_id", "email", name="uq_email_recipient_list_email"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_recipient_lists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    variables: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)

    recipient_list: Mapped[EmailRecipientList] = relationship(
        "EmailRecipientList", back_populates="members", lazy="select"
    )


class EmailAttachment(Base, TimestampMixin):
    __tablename__ = "email_attachments"
    __table_args__ = (
        Index("ix_email_attachments_message", "message_id"),
        Index("ix_email_attachments_template", "template_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 索引由 __table_args__ 的具名 Index 提供；勿加 index=True 否則會產生重複索引
    # ix_email_attachments_message_id/_template_id，並讓 alembic autogenerate 一直回報 drift。
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_templates.id", ondelete="SET NULL"),
        nullable=True,
    )
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    delivery_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default=EmailAttachmentMode.ATTACHMENT
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    message: Mapped[EmailMessage | None] = relationship(
        "EmailMessage", back_populates="attachments", lazy="select"
    )
    template: Mapped[EmailTemplate | None] = relationship(
        "EmailTemplate", back_populates="attachments", lazy="select"
    )


class EmailRecipientEvent(Base, TimestampMixin):
    __tablename__ = "email_recipient_events"
    __table_args__ = (
        UniqueConstraint("provider_event_id", name="uq_email_recipient_provider_event"),
        Index("ix_email_recipient_events_recipient_type", "recipient_id", "event_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("email_campaign_recipients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider_event_id: Mapped[str] = mapped_column(String(150), nullable=False)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)

    recipient: Mapped[EmailCampaignRecipient] = relationship(
        "EmailCampaignRecipient", back_populates="events", lazy="select"
    )


class EmailSuppression(Base, TimestampMixin):
    __tablename__ = "email_suppressions"
    __table_args__ = (Index("ix_email_suppressions_active_reason", "is_active", "reason"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="system")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    suppressed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
