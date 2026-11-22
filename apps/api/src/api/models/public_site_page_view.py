"""公開文章閱讀紀錄。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base


class PublicSitePageView(Base):
    """只保存匿名化訪客雜湊，不保存 IP 或完整 User-Agent。"""

    __tablename__ = "public_site_page_views"
    __table_args__ = (
        Index("ix_public_site_page_views_created_at", "created_at"),
        Index("ix_public_site_page_views_page_created_at", "page_id", "created_at"),
        Index("ix_public_site_page_views_visitor_created_at", "visitor_hash", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public_site_pages.id", ondelete="CASCADE"),
        nullable=False,
    )
    visitor_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    device_class: Mapped[str] = mapped_column(String(16), nullable=False, default="desktop")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


__all__ = ["PublicSitePageView"]
