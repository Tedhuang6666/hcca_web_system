"""公文系統 ORM 模型 - Document / Revision / Approval / Attachment / Recipient / SerialTemplate"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.regulation import Regulation
    from api.models.user import User


# ── 狀態枚舉 ──────────────────────────────────────────────────────────────────


class DocumentStatus(enum.StrEnum):
    DRAFT = "draft"  # 草稿（可編輯）
    PENDING = "pending"  # 待審核
    APPROVED = "approved"  # 已核准
    REJECTED = "rejected"  # 已退件
    ARCHIVED = "archived"  # 已封存


class ApprovalStepStatus(enum.StrEnum):
    WAITING = "waiting"  # 等待前一關卡完成
    PENDING = "pending"  # 輪到此人審核
    APPROVED = "approved"  # 已核准
    REJECTED = "rejected"  # 已退件（退回至上一關，流程繼續）
    SKIPPED = "skipped"  # 略過（退件至承辦人後後續步驟設為此狀態）


class DelegateSource(enum.StrEnum):
    MANUAL = "manual"  # 針對單一步驟手動指定
    ASSIGNMENT = "assignment"  # 依請假代行授權自動帶入


# ── 新增枚舉（公文格式規範）──────────────────────────────────────────────────


class DocumentUrgency(enum.StrEnum):
    """速別"""

    EXPRESS = "express"  # 最速件
    PRIORITY = "priority"  # 速件
    NORMAL = "normal"  # 普通件


class DocumentClassification(enum.StrEnum):
    """密等"""

    NORMAL = "normal"  # 普通
    CONFIDENTIAL = "confidential"  # 密
    SECRET = "secret"  # 機密


class DeclassificationCondition(enum.StrEnum):
    """解密條件"""

    NONE = "none"
    AUTO_AT_DATE = "auto_at_date"
    MANUAL_APPROVAL = "manual_approval"


class DocumentCategory(enum.StrEnum):
    """公文類別"""

    DECREE = "decree"  # 令
    LETTER = "letter"  # 函
    ANNOUNCEMENT = "announcement"  # 公告
    REPORT = "report"  # 報告
    MEETING_NOTICE = "meeting_notice"  # 開會通知單
    OTHER = "other"  # 其他


class RecipientType(enum.StrEnum):
    """受文者類型"""

    MAIN = "main"  # 受文者（主旨對象）
    PRIMARY = "primary"  # 正本
    COPY = "copy"  # 副本


class DocumentVisibility(enum.StrEnum):
    """公文可見度"""

    SUBJECT_ONLY = "subject_only"  # 僅當事人（受文者 + 建立者 + 審核人）可見
    ORG_ONLY = "org_only"  # 僅所屬機關成員可見
    PUBLIC = "public"  # 全體登入使用者可見
    PUBLICLY_OPEN = "publicly_open"  # 未登入亦可查看


class YearMode(enum.StrEnum):
    """年份制度"""

    ROC = "roc"  # 民國年（預設）
    CE = "ce"  # 西元年


# ── 字號模板 (由擁有 doc.issue 權限的長官建立) ─────────────────────────────────


class DocumentSerialTemplate(Base, TimestampMixin):
    """
    字號模板（由各機關最高長官以 doc.issue 權限建立）。

    字號格式範例：嶺代生字第 1150000001 號
    - org_prefix: 嶺代（組織代碼）
    - category_char: 生（類別字）
    - year_mode: ROC（民國年）
    - counter: 原子性流水號

    只有擁有 doc.issue 權限的長官可以建立此模板，
    一般成員選擇模板後，系統原子性取得下一個序號。
    """

    __tablename__ = "document_serial_templates"
    __table_args__ = (
        UniqueConstraint("org_id", "org_prefix", "category_char", name="uq_serial_template"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # 組織代碼前綴，如「嶺代」「嶺學」「嶺議」
    org_prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    # 類別字，如「生」「議」「評」
    category_char: Mapped[str] = mapped_column(String(10), nullable=False)
    # 年份制度：ROC（民國）或 CE（西元）
    # values_callable 強制 SQLAlchemy 使用 .value（小寫 "roc"/"ce"）而非 .name（大寫 "ROC"/"CE"）
    year_mode: Mapped[YearMode] = mapped_column(
        Enum(YearMode, name="yearmode", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=YearMode.ROC,
    )
    # 是否跨年重置流水號（True=每年從 1 開始，False=持續累加）
    reset_on_new_year: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # 當前年份（跨年後由系統自動更新）
    current_year: Mapped[int] = mapped_column(Integer, nullable=False)
    # 當前流水號（每次發文原子性 +1）
    counter: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 是否有效（停用後不可選取）
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    # 是否為組織預設字號模板（一般公文起草時優先帶入）
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    # 是否為主席公布法規專用預設字號模板
    is_default_president_publish: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )
    # 描述（長官可填入說明，如「學生生活輔導類公文」）
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    org: Mapped[Org] = relationship("Org")
    creator: Mapped[User] = relationship("User")


# ── 公文內容範本 ───────────────────────────────────────────────────────────────


class DocumentTemplate(Base, TimestampMixin):
    """公文內容範本，供同組織成員快速起稿。"""

    __tablename__ = "document_templates"
    __table_args__ = (
        UniqueConstraint("org_id", "name", "version", name="uq_document_template_version"),
        Index("ix_document_templates_org_active", "org_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    issuer_full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    urgency: Mapped[DocumentUrgency] = mapped_column(
        Enum(
            DocumentUrgency,
            name="documenturgency",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentUrgency.NORMAL,
    )
    classification: Mapped[DocumentClassification] = mapped_column(
        Enum(
            DocumentClassification,
            name="documentclassification",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentClassification.NORMAL,
    )
    declassification_condition: Mapped[DeclassificationCondition] = mapped_column(
        Enum(
            DeclassificationCondition,
            name="declassificationcondition",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DeclassificationCondition.NONE,
    )
    category: Mapped[DocumentCategory] = mapped_column(
        Enum(
            DocumentCategory,
            name="documentcategory",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentCategory.LETTER,
        index=True,
    )
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    doc_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_required: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")

    meeting_purpose: Mapped[str | None] = mapped_column(String(500), nullable=True)
    meeting_location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    meeting_chairperson: Mapped[str | None] = mapped_column(String(100), nullable=True)

    handler_unit: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    retention_period: Mapped[str | None] = mapped_column(String(100), nullable=True)
    visibility_level: Mapped[DocumentVisibility] = mapped_column(
        Enum(
            DocumentVisibility,
            name="documentvisibility",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentVisibility.ORG_ONLY,
    )
    recipients: Mapped[list[dict]] = mapped_column(
        JSONDict, nullable=False, default=list, server_default="[]"
    )

    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    org: Mapped[Org] = relationship("Org")
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by])
    updater: Mapped[User | None] = relationship("User", foreign_keys=[updated_by])


# ── 主表：公文 ────────────────────────────────────────────────────────────────


class Document(Base, TimestampMixin):
    """
    公文主表。
    結構化欄位遵循標準公文格式（速別、密等、主旨、說明、辦法、承辦人、受文者）。
    """

    __tablename__ = "documents"
    __table_args__ = (
        # 列表查詢高頻複合索引
        Index("ix_documents_org_status", "org_id", "status"),
        Index("ix_documents_created_by_status", "created_by", "status"),
        Index("ix_documents_status_created_at", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 字號，格式：DOC-YYYY-NNNNNN（由 PostgreSQL Sequence 原子性生成）
    serial_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)

    # ── 基本屬性 ────────────────────────────────────────────────────────────
    # title：系統顯示標題（可由主旨自動帶入）
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # 發文機關全銜
    issuer_full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 速別
    urgency: Mapped[DocumentUrgency] = mapped_column(
        Enum(
            DocumentUrgency,
            name="documenturgency",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentUrgency.NORMAL,
    )
    # 密等
    classification: Mapped[DocumentClassification] = mapped_column(
        Enum(
            DocumentClassification,
            name="documentclassification",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentClassification.NORMAL,
    )
    # 解密條件
    declassification_condition: Mapped[DeclassificationCondition] = mapped_column(
        Enum(
            DeclassificationCondition,
            name="declassificationcondition",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DeclassificationCondition.NONE,
    )
    # 保密期限訖日（需搭配密等使用）
    confidentiality_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 公文類別（令/函/公告/報告）
    category: Mapped[DocumentCategory] = mapped_column(
        Enum(
            DocumentCategory,
            name="documentcategory",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentCategory.LETTER,
        index=True,
    )

    # ── 公文本文結構 ─────────────────────────────────────────────────────────
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)  # 主旨
    doc_description: Mapped[str | None] = mapped_column(Text, nullable=True)  # 說明
    action_required: Mapped[str | None] = mapped_column(Text, nullable=True)  # 辦法
    # 向下相容：保留 content 作為整合性文字內容（Markdown 格式）
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # ── 開會通知單專屬欄位（category = meeting_notice 時使用）──────────────
    meeting_purpose: Mapped[str | None] = mapped_column(String(500), nullable=True)  # 開會事由
    meeting_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # 開會時間
    meeting_location: Mapped[str | None] = mapped_column(String(200), nullable=True)  # 開會地點
    meeting_chairperson: Mapped[str | None] = mapped_column(String(100), nullable=True)  # 主席

    # ── 承辦人資訊 ───────────────────────────────────────────────────────────
    handler_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    handler_unit: Mapped[str | None] = mapped_column(String(100), nullable=True)
    handler_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 檔號
    file_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 保存年限
    retention_period: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # ── 流程狀態 ─────────────────────────────────────────────────────────────
    status: Mapped[DocumentStatus] = mapped_column(
        Enum(
            DocumentStatus,
            name="documentstatus",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentStatus.DRAFT,
        index=True,
    )
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # ── 時間戳記 ─────────────────────────────────────────────────────────────
    issued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # 發文日期
    due_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # 限辦日期
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 頁次資訊（列印後可回填）
    page_info: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # 可見度控制（主欄位；service 層須同步 is_public = visibility_level == PUBLICLY_OPEN）
    visibility_level: Mapped[DocumentVisibility] = mapped_column(
        Enum(
            DocumentVisibility,
            name="documentvisibility",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=DocumentVisibility.ORG_ONLY,
        index=True,
    )
    # 向下相容唯讀欄位（由 service 層在寫入 visibility_level 時同步維持一致）
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)

    # ── 關聯鍵 ───────────────────────────────────────────────────────────────
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
    # 使用的字號模板（若 None 則為舊格式 DOC-YYYY-NNNNNN）
    serial_template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("document_serial_templates.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    # 此公文公布的法規（令類公文專用，其他類型為 None）
    regulation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("regulations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # ── Relationships ────────────────────────────────────────────────────────
    org: Mapped[Org] = relationship("Org")
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by])
    regulation: Mapped[Regulation | None] = relationship("Regulation", foreign_keys=[regulation_id])
    serial_template: Mapped[DocumentSerialTemplate | None] = relationship(
        "DocumentSerialTemplate", foreign_keys=[serial_template_id]
    )
    revisions: Mapped[list[DocumentRevision]] = relationship(
        "DocumentRevision",
        back_populates="document",
        order_by="DocumentRevision.revision_number",
    )
    approvals: Mapped[list[DocumentApproval]] = relationship(
        "DocumentApproval",
        back_populates="document",
        order_by="DocumentApproval.step_order",
    )
    attachments: Mapped[list[DocumentAttachment]] = relationship(
        "DocumentAttachment",
        back_populates="document",
    )
    recipients: Mapped[list[DocumentRecipient]] = relationship(
        "DocumentRecipient",
        back_populates="document",
        cascade="all, delete-orphan",
    )


# ── 版本紀錄 ──────────────────────────────────────────────────────────────────


class DocumentRevision(Base, TimestampMixin):
    """公文版本快照（每次儲存/送審時建立）"""

    __tablename__ = "document_revisions"
    __table_args__ = (UniqueConstraint("document_id", "revision_number", name="uq_doc_revision"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    change_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    changed_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    document: Mapped[Document] = relationship("Document", back_populates="revisions")
    editor: Mapped[User] = relationship("User")


# ── 審核流程步驟 ───────────────────────────────────────────────────────────────


class DocumentApproval(Base, TimestampMixin):
    """審核流程步驟（多層級，按 step_order 排序逐一審核）"""

    __tablename__ = "document_approvals"
    __table_args__ = (UniqueConstraint("document_id", "step_order", name="uq_doc_approval_step"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    approver_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)  # 1, 2, 3...
    status: Mapped[ApprovalStepStatus] = mapped_column(
        Enum(
            ApprovalStepStatus,
            name="approvalstepstatus",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=ApprovalStepStatus.WAITING,
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 代理人：若主管不在位，授權他人代為簽核，並記錄「代」字
    delegate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    delegate_source: Mapped[DelegateSource | None] = mapped_column(
        Enum(
            DelegateSource,
            name="delegatesource",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=True,
        default=None,
    )
    is_acting: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )  # 是否以代理身份操作

    document: Mapped[Document] = relationship("Document", back_populates="approvals")
    approver: Mapped[User] = relationship("User", foreign_keys=[approver_id])
    delegate: Mapped[User | None] = relationship("User", foreign_keys=[delegate_id])


class DocumentApprovalDelegation(Base, TimestampMixin):
    """公文簽核代理授權（請假代行職權）。"""

    __tablename__ = "document_approval_delegations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    principal_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    delegate_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    org: Mapped[Org] = relationship("Org")
    principal_user: Mapped[User] = relationship("User", foreign_keys=[principal_user_id])
    delegate_user: Mapped[User] = relationship("User", foreign_keys=[delegate_user_id])
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by])


# ── 受文者 ────────────────────────────────────────────────────────────────────


class DocumentRecipient(Base, TimestampMixin):
    """受文者清單（正本 / 副本 / 主旨對象）"""

    __tablename__ = "document_recipients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recipient_type: Mapped[RecipientType] = mapped_column(
        Enum(
            RecipientType, name="recipienttype", values_callable=lambda obj: [e.value for e in obj]
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)  # 單位或個人名稱
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)  # 發文後寄送聯絡信箱

    document: Mapped[Document] = relationship("Document", back_populates="recipients")


# ── 附件 ──────────────────────────────────────────────────────────────────────


class DocumentAttachment(Base, TimestampMixin):
    """公文附件（本地存儲、S3 或外部連結）"""

    __tablename__ = "document_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)  # 原始檔名或連結顯示名稱
    display_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True
    )  # 使用者自訂顯示名稱
    storage_key: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )  # 本地路徑 or S3 key
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # bytes
    link_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)  # 外部連結 URL
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    document: Mapped[Document] = relationship("Document", back_populates="attachments")
    uploader: Mapped[User] = relationship("User")


__all__ = [
    "ApprovalStepStatus",
    "Document",
    "DocumentApproval",
    "DocumentAttachment",
    "DocumentCategory",
    "DocumentClassification",
    "DeclassificationCondition",
    "DocumentRecipient",
    "DocumentRevision",
    "DocumentSerialTemplate",
    "DocumentStatus",
    "DocumentUrgency",
    "DocumentVisibility",
    "RecipientType",
    "YearMode",
]
