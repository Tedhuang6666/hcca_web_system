"""段考題庫 ORM 模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class ExamGradeTrack(enum.StrEnum):
    FIRST = "first"  # 一類
    SECOND = "second"  # 二類
    THIRD = "third"  # 三類


class ExamPaper(Base, TimestampMixin):
    """段考題 PDF 原檔 metadata。"""

    __tablename__ = "exam_papers"
    __table_args__ = (
        Index(
            "ix_exam_papers_filters",
            "is_published",
            "academic_year",
            "semester",
            "grade",
            "grade_track",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    subject: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    academic_year: Mapped[int] = mapped_column(nullable=False, index=True)
    semester: Mapped[int] = mapped_column(nullable=False, index=True)
    grade: Mapped[int] = mapped_column(nullable=False, index=True)
    grade_track: Mapped[ExamGradeTrack | None] = mapped_column(
        Enum(
            ExamGradeTrack,
            name="examgradetrack",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=True,
        index=True,
    )
    exam_number: Mapped[int] = mapped_column(nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(
        String(100), nullable=False, default="application/pdf"
    )
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_published: Mapped[bool] = mapped_column(nullable=False, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True, index=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    uploader: Mapped[User] = relationship("User", foreign_keys=[uploaded_by])
    downloads: Mapped[list[ExamPaperDownload]] = relationship(
        "ExamPaperDownload", back_populates="paper", cascade="all, delete-orphan"
    )


class ExamPaperDownload(Base):
    """段考題個人化 PDF 下載紀錄。"""

    __tablename__ = "exam_paper_downloads"
    __table_args__ = (
        UniqueConstraint("trace_code", name="uq_exam_paper_download_trace_code"),
        Index("ix_exam_paper_downloads_paper_created", "paper_id", "downloaded_at"),
        Index("ix_exam_paper_downloads_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    trace_code: Mapped[str] = mapped_column(String(40), nullable=False)
    file_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    downloaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    paper: Mapped[ExamPaper] = relationship("ExamPaper", back_populates="downloads")
    user: Mapped[User] = relationship("User", foreign_keys=[user_id])


__all__ = ["ExamGradeTrack", "ExamPaper", "ExamPaperDownload"]
