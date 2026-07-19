"""政策文件與同意紀錄，對應 ADR-003。

PolicyDocument 是「我們的隱私政策 / ToS / 無障礙聲明 / Cookie 政策」的版本化容器：
- 同 kind 同時只能一個 is_active=True（DB partial unique index 強制）
- 新版發布 = 新增一筆 + 舊版標記 is_active=False
- 內容 markdown、版本 semver

PolicyConsent 是「使用者同意了哪一版」的法律證據：
- 首次登入或政策更新時強制同意
- 紀錄 ip / user_agent，將來爭議可舉證
- 同 user × policy_document 唯一（同意一次就夠）
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin


class PolicyKind(StrEnum):
    """政策種類。值用於 DB / API、不在內顯示。"""

    PRIVACY = "privacy"
    TERMS = "terms"
    ACCESSIBILITY = "accessibility"
    COOKIE = "cookie"
    SECURITY = "security"


class PrivacyRequestType(StrEnum):
    ACCESS = "access"
    EXPORT = "export"
    CORRECTION = "correction"
    DELETION = "deletion"
    RESTRICTION = "restriction"
    OBJECTION = "objection"


class PrivacyRequestStatus(StrEnum):
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    COMPLETED = "completed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class PolicyDocument(Base, TimestampMixin):
    """政策文件版本（隱私 / ToS / 無障礙 / Cookie / 安全）。"""

    __tablename__ = "policy_documents"
    __table_args__ = (
        # 同 kind + version 唯一（不能發兩次 v1.0.0）
        UniqueConstraint("kind", "version", name="uq_policy_documents_kind_version"),
        Index("ix_policy_documents_kind_active", "kind", "is_active"),
        Index("ix_policy_documents_effective_at", "effective_at"),
        Index(
            "uq_policy_documents_one_active_per_kind",
            "kind",
            unique=True,
            postgresql_where=text("is_active IS true"),
            sqlite_where=text("is_active = 1"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    """PolicyKind 之一。"""

    version: Mapped[str] = mapped_column(String(20), nullable=False)
    """semver，例如 "1.0.0"。"""

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    """顯示用標題。例如「校園自治平台隱私政策 v1.0」。"""

    content_md: Mapped[str] = mapped_column(Text, nullable=False)
    """完整政策內容，markdown。"""

    summary_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    """變更摘要（給使用者看「這次改了什麼」）。"""

    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    """生效日期。早於此日的同意視為對前一版。"""

    is_active: Mapped[bool] = mapped_column(default=False, nullable=False)
    """是否為當前生效版本。同 kind 只能一個 True。"""

    published_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    """發布者；可為 NULL（系統初次匯入）。"""

    requires_explicit_consent: Mapped[bool] = mapped_column(default=True, nullable=False)
    """True：首次登入 / 更新時強制 modal；False：僅 footer 顯示。"""

    def __repr__(self) -> str:
        return (
            f"<PolicyDocument id={self.id} kind={self.kind} "
            f"v{self.version} active={self.is_active}>"
        )


class PolicyConsent(Base, TimestampMixin):
    """使用者對某政策版本的同意紀錄。"""

    __tablename__ = "policy_consents"
    __table_args__ = (
        # 同一使用者對同一版本只需同意一次
        UniqueConstraint(
            "user_id",
            "policy_document_id",
            name="uq_policy_consents_user_document",
        ),
        Index("ix_policy_consents_user", "user_id"),
        Index("ix_policy_consents_document", "policy_document_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    policy_document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("policy_documents.id", ondelete="RESTRICT"), nullable=False
    )

    agreed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    """IPv4 (15) 或 IPv6 (45)。"""

    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    """瀏覽器 UA。截斷至 500 char。"""

    def __repr__(self) -> str:
        return (
            f"<PolicyConsent id={self.id} user_id={self.user_id} "
            f"document_id={self.policy_document_id}>"
        )


class PrivacyRequest(Base, TimestampMixin):
    """當事人依隱私政策/個資法提出的資料權利請求。"""

    __tablename__ = "privacy_requests"
    __table_args__ = (
        Index("ix_privacy_requests_user_status", "user_id", "status"),
        Index("ix_privacy_requests_type_status", "request_type", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    request_type: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default=PrivacyRequestStatus.SUBMITTED.value
    )
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    submitted_user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    response_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    handled_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


__all__ = [
    "PolicyConsent",
    "PolicyDocument",
    "PolicyKind",
    "PrivacyRequest",
    "PrivacyRequestStatus",
    "PrivacyRequestType",
]
