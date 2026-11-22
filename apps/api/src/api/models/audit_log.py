"""稽核日誌 ORM 模型 — 記錄所有重要操作的不可變軌跡"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.types import JSONDict


class AuditLog(Base):
    """
    不可變稽核日誌。每筆操作寫入一行，禁止 UPDATE/DELETE。
    entity_type: 資源種類，如 "document", "regulation", "user", "permission"
    action:      操作動詞，如 "create", "approve", "reject", "publish", "archive"
    meta:        任意附帶資訊（前後狀態差異、IP、備註等），不存放敏感憑證

    雜湊鏈（ADR-004）：
      prev_hash: 前一筆紀錄的 self_hash；首筆為 GENESIS_HASH
      self_hash: 本筆內容 + prev_hash 的 SHA-256
    prev_hash / self_hash 由 audit_chain.write_audit_log_with_chain 自動填入。
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
        Index("ix_audit_logs_actor", "actor_id"),
        Index("ix_audit_logs_created_at", "created_at"),
        Index("ix_audit_logs_self_hash", "self_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 人類可讀摘要（搜尋用）
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 雜湊鏈；新寫入由 audit_chain.write_audit_log_with_chain 自動填。
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    self_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


__all__ = ["AuditLog"]
