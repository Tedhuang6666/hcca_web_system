"""Saved filters (shareable search presets)"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.user import User


class SavedFilterScope(str):
    DOCUMENTS = "documents"
    REGULATIONS = "regulations"
    JUDICIAL = "judicial"


class SavedFilter(Base, TimestampMixin):
    __tablename__ = "saved_filters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    scope: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Store query params as JSON (e.g. {"status":"pending","org_id":"..."}).
    params: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)

    # Optional: quick share URL (frontend can reconstruct directly from params too).
    share_path: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship("User")


__all__ = ["SavedFilter", "SavedFilterScope"]
