"""法規系統 ORM 模型 - Regulation / RegulationRevision / RegulationArticle"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.user import User


class RegulationCategory(enum.StrEnum):
    """
    法規分類（對應參考專案 LegislationCategory）
    前五項為法律位階（Constitution/Law），後四項為命令位階（Order）。
    """
    CONSTITUTION = "constitution"                # 憲章
    CHAIRMAN = "chairman"                        # 主席與副主席相關法規
    EXECUTIVE_DEPT = "executive_dept"            # 行政部門相關法規
    STUDENT_COUNCIL = "student_council"          # 學生議會相關法規
    JUDICIAL_COMMITTEE = "judicial_committee"    # 評議委員會相關法規
    EXECUTIVE_ORDER = "executive_order"          # 行政命令
    COUNCIL_ORDER = "council_order"              # 議會命令
    JUDICIAL_ORDER = "judicial_order"            # 評議委員會命令
    ELECTION_ORDER = "election_order"            # 選舉委員會命令
    OTHER = "other"                              # 其他


class ArticleType(enum.StrEnum):
    """
    條文結構層級（對應參考 ContentType）。
    Volume(編) > Chapter(章) > Section(節) > Subsection(款) > Clause(條)
    SpecialClause 為特殊條文（如附則）。
    """
    VOLUME = "volume"          # 編
    CHAPTER = "chapter"        # 章
    SECTION = "section"        # 節
    SUBSECTION = "subsection"  # 款
    CLAUSE = "clause"          # 條（有內容）
    SPECIAL_CLAUSE = "special_clause"  # 特殊條文


class Regulation(Base, TimestampMixin):
    """
    法規主表。
    content 為 Markdown 整合格式，articles 為結構化條文清單。
    透過 revisions 追蹤歷次修訂記錄。
    """

    __tablename__ = "regulations"
    __table_args__ = (
        # 全文搜尋輔助索引（使用 PostgreSQL GIN/tsvector，於 Migration 中建立）
        Index("ix_regulations_title", "title"),
        Index("ix_regulations_category", "category"),
        Index("ix_regulations_is_active", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[RegulationCategory] = mapped_column(
        Enum(RegulationCategory, name="regulationcategory"),
        nullable=False,
    )
    # Markdown 格式正文（前端渲染；同時保留結構化 articles）
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 前言/序言（選填）
    preface: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 版本號：每次 update 自動遞增
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 是否現行有效
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # 發布時間（None 表示草稿）
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )

    org: Mapped[Org] = relationship("Org")
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by])
    revisions: Mapped[list[RegulationRevision]] = relationship(
        "RegulationRevision", back_populates="regulation",
        order_by="RegulationRevision.version",
        cascade="all, delete-orphan",
    )
    articles: Mapped[list[RegulationArticle]] = relationship(
        "RegulationArticle", back_populates="regulation",
        order_by="RegulationArticle.sort_index",
        cascade="all, delete-orphan",
    )


# ── 修訂歷程 ──────────────────────────────────────────────────────────────────

class RegulationRevision(Base, TimestampMixin):
    """
    法規修訂歷程快照（每次發布更新時建立）。
    對應參考 LegislationHistory。
    """

    __tablename__ = "regulation_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    regulation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("regulations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 此快照對應的版本號
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    # 修訂摘要（Brief）
    change_brief: Mapped[str] = mapped_column(String(500), nullable=False)
    # 是否為全文修訂（totalAmendment）
    is_total_amendment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 全文內容快照（Markdown）
    content_snapshot: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 相關決議連結（JSON 字串，以逗號分隔多個 URL）
    resolution_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    amended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    amended_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    regulation: Mapped[Regulation] = relationship("Regulation", back_populates="revisions")
    amender: Mapped[User] = relationship("User")


# ── 結構化條文 ────────────────────────────────────────────────────────────────

class RegulationArticle(Base, TimestampMixin):
    """
    結構化條文（對應參考 LegislationContent）。
    依 sort_index 排列，支援多層結構（編/章/節/款/條）。
    """

    __tablename__ = "regulation_articles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    regulation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("regulations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 排序索引（同法規內唯一，由服務層管理）
    sort_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 層級類型
    article_type: Mapped[ArticleType] = mapped_column(
        Enum(ArticleType, name="articletype"), nullable=False,
    )
    # 條文標題（如「第一章 總則」的「總則」）
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    # 條文副標題（如「第一條 目的」的「目的」）
    subtitle: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    # 條文內容（Chapter 類型可為 None）
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 是否已刪除（軟刪除，保留歷史）
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 凍結說明（若條文遭凍結，記錄原因）
    frozen_by: Mapped[str | None] = mapped_column(String(200), nullable=True)

    regulation: Mapped[Regulation] = relationship("Regulation", back_populates="articles")


__all__ = [
    "ArticleType",
    "Regulation",
    "RegulationArticle",
    "RegulationCategory",
    "RegulationRevision",
]
