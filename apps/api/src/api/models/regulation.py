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
    from api.models.document import Document
    from api.models.org import Org
    from api.models.user import User


class RegulationCategory(enum.StrEnum):
    """
    法規分類（對應參考專案 LegislationCategory）
    前五項為法律位階（Constitution/Law），後四項為命令位階（Order）。
    """

    CONSTITUTION = "constitution"  # 憲章
    CHAIRMAN = "chairman"  # 主席與副主席相關法規
    EXECUTIVE_DEPT = "executive_dept"  # 行政部門相關法規
    STUDENT_COUNCIL = "student_council"  # 學生議會相關法規
    JUDICIAL_COMMITTEE = "judicial_committee"  # 評議委員會相關法規
    EXECUTIVE_ORDER = "executive_order"  # 行政命令
    COUNCIL_ORDER = "council_order"  # 議會命令
    JUDICIAL_ORDER = "judicial_order"  # 評議委員會命令
    ELECTION_ORDER = "election_order"  # 選舉委員會命令
    OTHER = "other"  # 其他


class RegulationWorkflowStatus(enum.StrEnum):
    """法規審議流程狀態"""

    DRAFT = "draft"  # 草稿
    UNDER_REVIEW = "under_review"  # 送審中（已送交議會）
    SCHEDULED = "scheduled"  # 已排入議程
    COUNCIL_APPROVED = "council_approved"  # 議會核定
    PUBLISHED = "published"  # 已公布
    REJECTED = "rejected"  # 已退回
    ARCHIVED = "archived"  # 已廢止


class RegulationAmendmentType(enum.StrEnum):
    ENACT = "enact"  # 制定
    AMEND = "amend"  # 修正
    ABOLISH = "abolish"  # 廢止


class ArticleType(enum.StrEnum):
    """
    條文結構層級。
    正確層級：Volume(編) > Chapter(章) > Section(節) > Article(條) > Paragraph(項) > Subparagraph(款) > Item(目)
    SpecialClause 為特殊條文（如附則）。
    注意：CLAUSE/SUBSECTION 為舊值，保留向下相容（對應 條/款），新建資料請使用 ARTICLE/SUBPARAGRAPH。
    """

    VOLUME = "volume"  # 編
    CHAPTER = "chapter"  # 章
    SECTION = "section"  # 節
    ARTICLE = "article"  # 條
    PARAGRAPH = "paragraph"  # 項
    SUBPARAGRAPH = "subparagraph"  # 款
    ITEM = "item"  # 目
    SPECIAL_CLAUSE = "special_clause"  # 特殊條文（如附則）
    # ── 舊值保留向下相容（已廢棄，請勿新用）──
    CLAUSE = "clause"  # 舊：條（以 ARTICLE 取代）
    SUBSECTION = "subsection"  # 舊：款（以 SUBPARAGRAPH 取代）


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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[RegulationCategory] = mapped_column(
        Enum(
            RegulationCategory,
            name="regulationcategory",
            values_callable=lambda obj: [e.value for e in obj],
        ),
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
    # 審議流程狀態
    workflow_status: Mapped[RegulationWorkflowStatus] = mapped_column(
        Enum(
            RegulationWorkflowStatus,
            name="regulationworkflowstatus",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=RegulationWorkflowStatus.DRAFT,
        server_default="draft",
    )
    # 流程備註（退回原因等）
    workflow_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 修法型態
    amendment_type: Mapped[RegulationAmendmentType] = mapped_column(
        Enum(
            RegulationAmendmentType,
            name="regulationamendmenttype",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=RegulationAmendmentType.ENACT,
        server_default="enact",
    )
    # 修正條號清單（逗號分隔）
    amended_articles: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 生效日期
    effective_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 沿革
    legislative_history: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 法源依據
    legal_basis: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 提案/決議資訊
    proposal_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # 公布時自動產生的正式公文（令），nullable 代表尚未公布
    published_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 整部法規凍結依據（凍結時填入說明，解凍時清空）
    freeze_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 凍結時間
    freeze_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 凍結依據公文
    freeze_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="SET NULL"),
        nullable=True,
    )
    # 是否已廢止
    is_repealed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 廢止日期
    repealed_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 廢止理由
    repeal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 替代法規 ID（若此法規被其他法規取代）
    repeal_replacement_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    org: Mapped[Org] = relationship("Org")
    published_document: Mapped[Document | None] = relationship(
        "Document", foreign_keys=[published_document_id]
    )
    freeze_document: Mapped[Document | None] = relationship(
        "Document", foreign_keys=[freeze_document_id]
    )
    repeal_replacement: Mapped[Regulation | None] = relationship(
        "Regulation",
        remote_side=[id],
        foreign_keys=[repeal_replacement_id],
    )
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by])
    revisions: Mapped[list[RegulationRevision]] = relationship(
        "RegulationRevision",
        back_populates="regulation",
        order_by="RegulationRevision.version",
        cascade="all, delete-orphan",
    )
    articles: Mapped[list[RegulationArticle]] = relationship(
        "RegulationArticle",
        back_populates="regulation",
        order_by="RegulationArticle.sort_index",
        cascade="all, delete-orphan",
    )
    workflow_logs: Mapped[list[RegulationWorkflowLog]] = relationship(
        "RegulationWorkflowLog",
        back_populates="regulation",
        order_by="RegulationWorkflowLog.created_at",
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
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 此快照對應的版本號
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    # 修訂摘要（Brief）
    change_brief: Mapped[str] = mapped_column(String(500), nullable=False)
    # 是否為全文修訂（totalAmendment）
    is_total_amendment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 全文內容快照（Markdown）
    content_snapshot: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 結構化條文快照（JSON 字串）
    article_snapshot: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    # 提案內容快照（逐條修正理由、提案說明等）
    proposal_metadata_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
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
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 排序索引（同法規內唯一，由服務層管理）
    sort_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 同層級排序索引（樹狀編輯器使用）
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 父節點（null 表示根節點）
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulation_articles.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # 層級類型
    article_type: Mapped[ArticleType] = mapped_column(
        Enum(ArticleType, name="articletype", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )
    # 條文標題（如「第一章 總則」的「總則」）
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    # 條文副標題（如「第一條 目的」的「目的」）
    subtitle: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    # 法律條號（例如：1, 5-1）
    legal_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 條文內容（Chapter 類型可為 None）
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 是否已刪除（軟刪除，保留歷史）
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 凍結說明（若條文遭凍結，記錄原因）
    frozen_by: Mapped[str | None] = mapped_column(String(200), nullable=True)

    regulation: Mapped[Regulation] = relationship("Regulation", back_populates="articles")
    parent: Mapped[RegulationArticle | None] = relationship(
        "RegulationArticle",
        remote_side=[id],
        foreign_keys=[parent_id],
        back_populates="children",
    )
    children: Mapped[list[RegulationArticle]] = relationship(
        "RegulationArticle",
        back_populates="parent",
        cascade="all, delete-orphan",
    )


# ── 審議流程日誌 ──────────────────────────────────────────────────────────────


class RegulationWorkflowLog(Base, TimestampMixin):
    """法規審議流程變更紀錄（每次狀態轉移建立一筆）"""

    __tablename__ = "regulation_workflow_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    regulation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_status: Mapped[str] = mapped_column(String(50), nullable=False)
    to_status: Mapped[str] = mapped_column(String(50), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    regulation: Mapped[Regulation] = relationship("Regulation", back_populates="workflow_logs")
    actor: Mapped[User] = relationship("User")


__all__ = [
    "ArticleType",
    "Regulation",
    "RegulationArticle",
    "RegulationAmendmentType",
    "RegulationCategory",
    "RegulationRevision",
    "RegulationWorkflowLog",
    "RegulationWorkflowStatus",
]
