"""Outbox 事件表 — 保證通知至少發送一次（at-least-once delivery）

流程：
  1. DB 操作成功時，同一事務內寫入 OutboxEvent（status=pending）
  2. Celery Beat 每 30 秒掃一次未處理事件，呼叫對應處理器
  3. 處理成功後標記 processed_at；失敗則遞增 retry_count
  4. retry_count > 5 的事件移到 dead letter（status=dead）
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.types import JSONDict


class OutboxStatus(enum.StrEnum):
    PENDING = "pending"
    PROCESSED = "processed"
    DEAD = "dead"


class OutboxEvent(Base):
    __tablename__ = "outbox_events"
    __table_args__ = (Index("ix_outbox_status_created", "status", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 事件類型，決定 Celery handler 分派邏輯
    # 例：document.approved / regulation.published / order.created
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # 事件承載資料（ID、相關欄位）
    payload: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    status: Mapped[OutboxStatus] = mapped_column(
        String(20), nullable=False, default=OutboxStatus.PENDING
    )
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 上次錯誤訊息（便於排查 dead 事件）
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


__all__ = ["OutboxEvent", "OutboxStatus"]
