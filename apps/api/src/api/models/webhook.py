"""Outbound Webhook 訂閱與投遞紀錄。

設計：
- WebhookSubscription：訂閱者（owner_user_id）告訴系統「這些事件請打到這個 URL」
- WebhookDelivery：每次投遞嘗試的紀錄（成功 / 失敗 / 重試）
- 事件用既有 Outbox 機制（at-least-once 保證）觸發 Celery
- HMAC 簽章：X-Webhook-Signature: sha256=<hex>，secret 為 WebhookSubscription.secret
- 重試策略：exponential backoff、最多 7 次（5min, 25min, 2h, 12h, 1d, 3d, 7d）

事件型別命名規範（建議）：
- `<domain>.<action>` 例如 `document.approved`、`announcement.published`
- `<domain>.<entity>.<action>` 例如 `meeting.attendance.updated`
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict, JSONList


class DeliveryStatus(StrEnum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    DEAD = "dead"  # 重試耗盡


class WebhookSubscription(Base, TimestampMixin):
    """單一訂閱（owner 對特定事件清單的單一 endpoint）。"""

    __tablename__ = "webhook_subscriptions"
    __table_args__ = (
        Index("ix_webhook_subs_owner", "owner_user_id"),
        Index("ix_webhook_subs_active", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    """訂閱者命名，例如 "校友系統公文同步"。"""

    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    url: Mapped[str] = mapped_column(String(500), nullable=False)
    """投遞目標 HTTPS URL。"""

    events: Mapped[list[str]] = mapped_column(JSONList, nullable=False, default=list)
    """訂閱的事件名稱列表。"""

    secret: Mapped[str] = mapped_column(String(200), nullable=False)
    """HMAC-SHA256 簽章用 secret。建立時產生、之後可 rotate。"""

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=7)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    deliveries: Mapped[list[WebhookDelivery]] = relationship(
        "WebhookDelivery",
        back_populates="subscription",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<WebhookSubscription id={self.id} name={self.name!r}>"


class WebhookDelivery(Base, TimestampMixin):
    """單次投遞嘗試紀錄。同一事件可多筆（重試）。"""

    __tablename__ = "webhook_deliveries"
    __table_args__ = (
        Index("ix_webhook_deliveries_sub", "subscription_id"),
        Index("ix_webhook_deliveries_status", "status"),
        Index("ix_webhook_deliveries_scheduled", "scheduled_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    subscription_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("webhook_subscriptions.id", ondelete="CASCADE"),
        nullable=False,
    )

    event_type: Mapped[str] = mapped_column(String(100), nullable=False)

    payload: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    """DeliveryStatus 之一。"""

    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    """下次嘗試時間。失敗 + 還沒到 max_retries → 更新此欄為 backoff 後時間。"""

    last_attempted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    succeeded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)

    response_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    """前 2000 chars 的回應，debug 用。"""

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    subscription: Mapped[WebhookSubscription] = relationship(
        "WebhookSubscription", back_populates="deliveries", lazy="joined"
    )

    def __repr__(self) -> str:
        return (
            f"<WebhookDelivery id={self.id} event={self.event_type} "
            f"status={self.status} attempt={self.attempt_count}>"
        )


__all__ = ["DeliveryStatus", "WebhookDelivery", "WebhookSubscription"]
