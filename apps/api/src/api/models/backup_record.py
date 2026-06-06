"""備份紀錄 model。

每次成功備份寫一筆，記錄：
- 來源（db 名稱、檔案大小）
- 加密狀態（gpg passphrase 是否生效）
- 上傳目的地（本地 / S3 異地）
- sha256 校驗碼（還原時驗證）
- 上傳完成時間

用途：
- 還原前能挑特定一筆並驗證完整性
- 月底 cost review 知道實際備份量
- DR drill 演練用最近成功的那筆
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin


class BackupKind(StrEnum):
    DB = "db"
    UPLOADS = "uploads"
    AUDIT_ANCHOR = "audit_anchor"


class BackupStatus(StrEnum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class BackupRecord(Base, TimestampMixin):
    """單次備份的紀錄。"""

    __tablename__ = "backup_records"
    __table_args__ = (
        Index("ix_backup_records_kind_created", "kind", "created_at"),
        Index("ix_backup_records_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    """BackupKind 之一。"""

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    """BackupStatus 之一。"""

    source_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    """來源描述。例如 "campus_platform" (DB)、"uploads/" (檔案)。"""

    local_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    """本地檔案路徑（保留輪轉期內可見）。"""

    s3_bucket: Mapped[str | None] = mapped_column(String(200), nullable=True)
    s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    s3_region: Mapped[str | None] = mapped_column(String(50), nullable=True)

    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    """加密 / 壓縮後實際大小。"""

    sha256_hex: Mapped[str | None] = mapped_column(String(64), nullable=True)
    """加密後檔案的 SHA-256 校驗碼。還原時必比對。"""

    encrypted: Mapped[bool] = mapped_column(default=False, nullable=False)
    """是否經過 GPG 對稱加密。"""

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    def __repr__(self) -> str:
        return (
            f"<BackupRecord id={self.id} kind={self.kind} "
            f"status={self.status} size={self.size_bytes}>"
        )


__all__ = ["BackupKind", "BackupRecord", "BackupStatus"]
