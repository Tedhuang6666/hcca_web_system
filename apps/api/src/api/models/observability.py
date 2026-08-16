from datetime import UTC, datetime
from uuid import UUID as UUIDType
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import DOUBLE_PRECISION, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base


class ObservabilityRelease(Base):
    __tablename__ = "observability_releases"
    id: Mapped[UUIDType] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    release: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    commit_sha: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    environment: Mapped[str] = mapped_column(String(32), nullable=False)
    deployed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )


class PageSpeedRun(Base):
    __tablename__ = "pagespeed_runs"
    id: Mapped[UUIDType] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    strategy: Mapped[str] = mapped_column(String(16), nullable=False)
    tested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    release_id: Mapped[UUIDType | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("observability_releases.id", ondelete="SET NULL")
    )
    performance_score: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    lcp_ms: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    tbt_ms: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    cls: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    status: Mapped[str] = mapped_column(String(16), default="ok", nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)


class PageSpeedAudit(Base):
    __tablename__ = "pagespeed_audits"
    id: Mapped[UUIDType] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[UUIDType] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pagespeed_runs.id", ondelete="CASCADE"), nullable=False
    )
    audit_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    numeric_value: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    display_value: Mapped[str | None] = mapped_column(Text)


class CruxSnapshot(Base):
    __tablename__ = "crux_snapshots"
    id: Mapped[UUIDType] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    form_factor: Mapped[str] = mapped_column(String(16), nullable=False)
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    lcp_p75: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    inp_p75: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    cls_p75: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
    ttfb_p75: Mapped[float | None] = mapped_column(DOUBLE_PRECISION)
