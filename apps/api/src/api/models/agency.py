"""自治機關專頁 ORM 模型：學生會、學生議會、評議委員會、學生代表團。"""

from __future__ import annotations

import enum
import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin


class AgencyBranch(enum.StrEnum):
    """機關性質；決定公開頁版型與可用的公開項目類型。"""

    EXECUTIVE = "executive"
    LEGISLATIVE = "legislative"
    JUDICIAL = "judicial"
    DELEGATION = "delegation"


class AgencyProfile(Base, TimestampMixin):
    """機關專頁，由 org_id 指定的組織成員維護。"""

    __tablename__ = "agency_profiles"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_agency_profiles_slug"),
        Index("ix_agency_profiles_published_sort", "is_published", "sort_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(40), nullable=False)
    branch: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    tagline: Mapped[str | None] = mapped_column(String(200), nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    intro_md: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # 職權與法源、組織架構說明
    mandate_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_published: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    entries: Mapped[list[AgencyEntry]] = relationship(
        "AgencyEntry", back_populates="agency", cascade="all, delete-orphan", passive_deletes=True
    )


class AgencyEntry(Base, TimestampMixin):
    """機關公開項目：政策、成果、議事、法案、委員會、評議結果、提案等。"""

    __tablename__ = "agency_entries"
    __table_args__ = (
        Index("ix_agency_entries_agency_kind_published", "agency_id", "kind", "is_published"),
        Index("ix_agency_entries_calendar", "show_on_calendar", "occurred_on"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agency_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agency_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # 案號、議案編號、字號等
    reference_no: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 執行情形、審議結果、評議主文、校方回應
    outcome_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # 附件、Google 雲端協作文件或外部連結
    link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 有 occurred_on 時列入首頁行事曆
    show_on_calendar: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    is_published: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    agency: Mapped[AgencyProfile] = relationship("AgencyProfile", back_populates="entries")
