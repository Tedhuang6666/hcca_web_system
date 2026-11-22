"""公開的班聯短網址。"""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin


class ShortLink(Base, TimestampMixin):
    """將穩定的班聯網址 slug 對應到可維護的目的網址。"""

    __tablename__ = "short_links"
    __table_args__ = (UniqueConstraint("slug", name="uq_short_links_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    target_url: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )


__all__ = ["ShortLink"]
