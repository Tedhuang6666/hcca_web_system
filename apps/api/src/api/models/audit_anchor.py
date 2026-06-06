"""AuditLog 雜湊鏈與每日 anchor 模型，對應 ADR-004。

本檔僅新增 AuditLogAnchor model。對 AuditLog 本身的 prev_hash / self_hash
欄位擴充見 [apps/api/src/api/models/audit_log.py]（單獨 migration）。

每日 Celery beat 00:05 跑 `compute_daily_anchor_task`：
1. 找當日最後一筆 AuditLog
2. 取其 self_hash 為 head_hash
3. 寫入 AuditLogAnchor（unique on date）
4. 把 anchor json 上傳到 S3 Object Lock bucket（7 年 retention）
5. 失敗 → Discord 告警

完整性檢查每週六 03:00 跑：
1. 取最近 anchor
2. 從 anchor 對應的 last_audit_log_id 倒推、重算 self_hash
3. 任一不符 → Sentry + Discord
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin


class AuditLogAnchor(Base, TimestampMixin):
    """每日稽核日誌錨點（不可篡改證據）。"""

    __tablename__ = "audit_log_anchors"
    __table_args__ = (
        UniqueConstraint("anchor_date", name="uq_audit_log_anchors_date"),
        Index("ix_audit_log_anchors_date", "anchor_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    anchor_date: Mapped[date] = mapped_column(Date, nullable=False)
    """錨點所屬日期（UTC）。"""

    last_audit_log_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("audit_logs.id"),
        nullable=True,
    )
    """該日最後一筆 AuditLog。若該日無紀錄則 NULL。"""

    head_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    """該日最後一筆的 self_hash（SHA-256 hex）；無紀錄日為前一日 head。"""

    log_count: Mapped[int] = mapped_column(nullable=False, default=0)
    """該日紀錄數量。完整性檢查時用作配對。"""

    s3_object_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    """anchor json 上傳成功的 S3 URL。失敗為 NULL（會 retry）。"""

    s3_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    """S3 上傳成功時間。"""

    integrity_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    """最近一次完整性檢查通過時間。"""

    def __repr__(self) -> str:
        return (
            f"<AuditLogAnchor date={self.anchor_date} "
            f"head_hash={self.head_hash[:8]}... count={self.log_count}>"
        )


__all__ = ["AuditLogAnchor"]
