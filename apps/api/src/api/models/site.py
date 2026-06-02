"""公開官網 ORM 模型。"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.org import UserPosition


class PublicSiteSettings(Base, TimestampMixin):
    """公開官網單筆設定。"""

    __tablename__ = "public_site_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_title: Mapped[str] = mapped_column(String(120), nullable=False)
    site_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    site_logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    site_logo_alt: Mapped[str | None] = mapped_column(String(200), nullable=True)
    hero_title: Mapped[str] = mapped_column(String(120), nullable=False)
    hero_subtitle: Mapped[str | None] = mapped_column(Text, nullable=True)
    hero_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    hero_image_alt: Mapped[str | None] = mapped_column(String(200), nullable=True)
    about_title: Mapped[str] = mapped_column(String(120), nullable=False)
    about_body_md: Mapped[str] = mapped_column(Text, nullable=False)
    mission_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    history_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    cta_label: Mapped[str] = mapped_column(String(60), nullable=False)
    cta_href: Mapped[str] = mapped_column(String(500), nullable=False)
    public_database_label: Mapped[str] = mapped_column(String(60), nullable=False)
    public_database_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    theme_config: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    homepage_blocks: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    custom_css: Mapped[str | None] = mapped_column(Text, nullable=True)
    seo_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(300), nullable=True)


class PublicLinkCategory(Base, TimestampMixin):
    """Linktree 分類。"""

    __tablename__ = "public_link_categories"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_link_categories_slug"),
        Index("ix_public_link_categories_active_sort", "is_active", "sort_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )


class PublicLink(Base, TimestampMixin):
    """Linktree 對外連結。"""

    __tablename__ = "public_links"
    __table_args__ = (Index("ix_public_links_active_sort", "is_active", "sort_order"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("public_link_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    icon_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    category: Mapped[PublicLinkCategory | None] = relationship("PublicLinkCategory")


class PublicOfficerProfile(Base, TimestampMixin):
    """既有任期資料的公開顯示補充設定。"""

    __tablename__ = "public_officer_profiles"
    __table_args__ = (
        UniqueConstraint("user_position_id", name="uq_public_officer_profiles_user_position"),
        Index("ix_public_officer_profiles_visible_sort", "is_visible", "sort_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_position_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_positions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    display_name_override: Mapped[str | None] = mapped_column(String(100), nullable=True)
    title_override: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    public_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_links: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    is_featured: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    is_visible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    user_position: Mapped[UserPosition] = relationship("UserPosition")


class PublicSitePage(Base, TimestampMixin):
    """可由後台新增的公開官網頁面。"""

    __tablename__ = "public_site_pages"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_public_site_pages_slug"),
        Index("ix_public_site_pages_nav", "show_in_nav", "nav_order"),
        Index("ix_public_site_pages_published_sort", "is_published", "sort_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_md: Mapped[str] = mapped_column(Text, nullable=False)
    page_kind: Mapped[str] = mapped_column(
        String(30), nullable=False, default="standard", server_default="standard", index=True
    )
    layout_config: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    content_blocks: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
    cover_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_image_alt: Mapped[str | None] = mapped_column(String(200), nullable=True)
    seo_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    seo_description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    nav_label: Mapped[str | None] = mapped_column(String(60), nullable=True)
    nav_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    show_in_nav: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    is_published: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
