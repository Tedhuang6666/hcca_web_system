"""公告系統 ORM 模型 - Announcement / AnnouncementMedia"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    FetchedValue,
    ForeignKey,
    Index,
    String,
    Table,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.activity import Activity
    from api.models.org import Org
    from api.models.user import User


class AnnouncementAudience(StrEnum):
    """公告對象（決定可見範圍）。"""

    ALL = "all"  # 全體（含未登入訪客）
    SCHOOL = "school"  # 全體竹中生（校內信箱帳號）
    ORGS = "orgs"  # 特定組織（該組織現任成員）
    MEMBERS = "members"  # 特定成員（被指定的使用者）


# 公告對象關聯表（多對多）
announcement_audience_orgs = Table(
    "announcement_audience_orgs",
    Base.metadata,
    Column(
        "announcement_id",
        UUID(as_uuid=True),
        ForeignKey("announcements.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "org_id",
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

announcement_audience_users = Table(
    "announcement_audience_users",
    Base.metadata,
    Column(
        "announcement_id",
        UUID(as_uuid=True),
        ForeignKey("announcements.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


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
        # 全文搜尋 GIN 索引（PostgreSQL tsvector，generated column 由 migration 建立）
        Index("ix_announcements_search_vector", "search_vector", postgresql_using="gin"),
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
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # 公告對象（決定可見範圍）；orgs/members 細節存於 audience_orgs / audience_users
    audience_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=AnnouncementAudience.ALL.value,
        server_default=AnnouncementAudience.ALL.value,
    )

    # 全文搜尋向量（PostgreSQL GENERATED ALWAYS column，由 migration 維護，ORM 唯讀）。
    # FetchedValue 告訴 SQLAlchemy 此欄由 DB 端產生，INSERT/UPDATE 不可帶值，否則
    # asyncpg 會丟 GeneratedAlwaysError: cannot insert a non-DEFAULT value。
    search_vector: Mapped[str | None] = mapped_column(
        TSVECTOR(), FetchedValue(), nullable=True
    )

    org: Mapped[Org | None] = relationship("Org")
    activity: Mapped[Activity | None] = relationship("Activity")
    author: Mapped[User] = relationship("User", foreign_keys=[author_id])
    media: Mapped[list[AnnouncementMedia]] = relationship(
        "AnnouncementMedia",
        back_populates="announcement",
        cascade="all, delete-orphan",
    )
    # 對象 = 特定組織時的目標組織清單
    audience_orgs: Mapped[list[Org]] = relationship(
        "Org", secondary=announcement_audience_orgs, lazy="selectin"
    )
    # 對象 = 特定成員時的目標使用者清單
    audience_users: Mapped[list[User]] = relationship(
        "User", secondary=announcement_audience_users, lazy="selectin"
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
    __table_args__ = (UniqueConstraint("announcement_id", "user_id", name="uq_announcement_reads"),)

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
    "AnnouncementAudience",
    "AnnouncementMedia",
    "AnnouncementRead",
    "announcement_audience_orgs",
    "announcement_audience_users",
]
