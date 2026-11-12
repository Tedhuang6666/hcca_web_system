"""網站漏洞與功能問題回報 ORM 模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class SiteReportKind(enum.StrEnum):
    """回報類型：資安漏洞或一般功能錯誤。"""

    VULNERABILITY = "vulnerability"
    BUG = "bug"


class SiteReportSeverity(enum.StrEnum):
    """回報者自評的影響程度。"""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SiteReportStatus(enum.StrEnum):
    """處理狀態。"""

    NEW = "new"
    TRIAGED = "triaged"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    WONT_FIX = "wont_fix"
    DUPLICATE = "duplicate"


class SiteReport(Base, TimestampMixin):
    """公開網站收到的一筆漏洞／問題回報。"""

    __tablename__ = "site_reports"
    __table_args__ = (
        Index("ix_site_reports_status_created", "status", "created_at"),
        Index("ix_site_reports_kind_created", "kind", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reference_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(
        String(20), nullable=False, default=SiteReportKind.BUG.value, index=True
    )
    severity: Mapped[str] = mapped_column(
        String(20), nullable=False, default=SiteReportSeverity.MEDIUM.value, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=SiteReportStatus.NEW.value, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    steps_to_reproduce: Mapped[str | None] = mapped_column(Text, nullable=True)
    affected_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    reporter: Mapped[User | None] = relationship("User", foreign_keys=[reporter_id])
    reviewer: Mapped[User | None] = relationship("User", foreign_keys=[reviewed_by])


__all__ = [
    "SiteReport",
    "SiteReportKind",
    "SiteReportSeverity",
    "SiteReportStatus",
]
