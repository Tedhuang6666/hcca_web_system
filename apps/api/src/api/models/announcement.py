"""公告系統 ORM 模型 - Announcement / AnnouncementMedia"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.user import User


class Announcement(Base, TimestampMixin):
    """
    公告主表（Blog 形式）。
    content 為 Tiptap JSON 格式（JSONB 儲存，前端以 @tiptap/react 渲染）。
    is_urgent=True 時，使用者進入網頁會觸發 Popup 顯示。
    公告末端自動附上「公告人：{author.display_name}」（由前端渲染）。
    """

    __tablename__ = "announcements"
    __table_args__ = (
        Index("ix_announcements_org_published", "org_id", "is_published", "published_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # Tiptap JSON 格式內容（PostgreSQL 使用 JSONB，測試 SQLite 使用 JSON）
    content: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    # 是否為緊急公告（觸發首頁 Popup）
    is_urgent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    # 緊急公告有效截止時間（None = 永久有效直到手動關閉）
    urgent_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 是否已發布（草稿不公開）
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    # 所屬組織（None = 全站公告）
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    org: Mapped[Org | None] = relationship("Org")
    author: Mapped[User] = relationship("User", foreign_keys=[author_id])
    media: Mapped[list[AnnouncementMedia]] = relationship(
        "AnnouncementMedia",
        back_populates="announcement",
        cascade="all, delete-orphan",
    )


class AnnouncementMedia(Base, TimestampMixin):
    """
    公告媒體庫（圖片等媒體檔案）。
    上傳後取得 URL 插入 Tiptap 內容中，支援圖文混排。
    """

    __tablename__ = "announcement_media"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    announcement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("announcements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)

    announcement: Mapped[Announcement] = relationship("Announcement", back_populates="media")


class AnnouncementRead(Base, TimestampMixin):
    """記錄哪位使用者已閱讀哪篇公告（用於計算閱讀率）。"""

    __tablename__ = "announcement_reads"
    __table_args__ = (
        UniqueConstraint("announcement_id", "user_id", name="uq_announcement_reads"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    announcement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("announcements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    announcement: Mapped[Announcement] = relationship("Announcement")


__all__ = [
    "Announcement",
    "AnnouncementMedia",
    "AnnouncementRead",
]
