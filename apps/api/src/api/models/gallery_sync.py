"""活動影像的私人 Drive 設定與匯入紀錄。"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict


class GalleryDriveSync(Base, TimestampMixin):
    __tablename__ = "gallery_drive_sync"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, default="gallery")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    config: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    manifest: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    last_report: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
