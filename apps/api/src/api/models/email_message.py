"""平台寄信紀錄 ORM 模型 — 承載草稿 / 預約 / 已寄 / 失敗的所有狀態。

同一張表兼任：寄信稽核軌跡、草稿暫存、預約寄送佇列、每日配額計算來源。
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
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
    PARTIAL = "partial"  # 部分收件人已送出、部分失敗
    CANCELLED = "cancelled"  # 已取消（取消預約 / 刪除）


class EmailRecipientStatus(enum.StrEnum):
    """大量寄送時單一收件人的寄送狀態。"""

    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"


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

    sender: Mapped[User | None] = relationship("User", lazy="select")
    recipients: Mapped[list[EmailCampaignRecipient]] = relationship(
        "EmailCampaignRecipient",
        back_populates="message",
        lazy="select",
        cascade="all, delete-orphan",
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

    message: Mapped[EmailMessage] = relationship(
        "EmailMessage", back_populates="recipients", lazy="select"
    )
    user: Mapped[User | None] = relationship("User", lazy="select")
