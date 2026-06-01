"""add_public_site_module

Revision ID: e4b7c8d9a001
Revises: d3a7e1c2b5f0
Create Date: 2026-06-02 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e4b7c8d9a001"
down_revision: str | Sequence[str] | None = "d3a7e1c2b5f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "public_site_settings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("site_title", sa.String(length=120), nullable=False),
        sa.Column("site_description", sa.Text(), nullable=True),
        sa.Column("hero_title", sa.String(length=120), nullable=False),
        sa.Column("hero_subtitle", sa.Text(), nullable=True),
        sa.Column("hero_image_url", sa.Text(), nullable=True),
        sa.Column("hero_image_alt", sa.String(length=200), nullable=True),
        sa.Column("about_title", sa.String(length=120), nullable=False),
        sa.Column("about_body_md", sa.Text(), nullable=False),
        sa.Column("mission_md", sa.Text(), nullable=True),
        sa.Column("history_md", sa.Text(), nullable=True),
        sa.Column("cta_label", sa.String(length=60), nullable=False),
        sa.Column("cta_href", sa.String(length=500), nullable=False),
        sa.Column("public_database_label", sa.String(length=60), nullable=False),
        sa.Column("public_database_description", sa.Text(), nullable=True),
        sa.Column("theme_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("homepage_blocks", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("custom_css", sa.Text(), nullable=True),
        sa.Column("seo_title", sa.String(length=120), nullable=True),
        sa.Column("seo_description", sa.String(length=300), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "public_link_categories",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_public_link_categories_slug"),
    )
    op.create_index(
        "ix_public_link_categories_active_sort",
        "public_link_categories",
        ["is_active", "sort_order"],
    )
    op.create_table(
        "public_links",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category_id", sa.UUID(), nullable=True),
        sa.Column("icon_key", sa.String(length=40), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["category_id"], ["public_link_categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_public_links_active_sort", "public_links", ["is_active", "sort_order"])
    op.create_index(op.f("ix_public_links_category_id"), "public_links", ["category_id"])
    op.create_index(op.f("ix_public_links_is_active"), "public_links", ["is_active"])
    op.create_index(op.f("ix_public_links_sort_order"), "public_links", ["sort_order"])
    op.create_table(
        "public_officer_profiles",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_position_id", sa.UUID(), nullable=False),
        sa.Column("display_name_override", sa.String(length=100), nullable=True),
        sa.Column("title_override", sa.String(length=120), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("public_email", sa.String(length=255), nullable=True),
        sa.Column(
            "external_links",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_featured", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_visible", sa.Boolean(), server_default="true", nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_position_id"], ["user_positions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_position_id", name="uq_public_officer_profiles_user_position"),
    )
    op.create_index(
        "ix_public_officer_profiles_visible_sort",
        "public_officer_profiles",
        ["is_visible", "sort_order"],
    )
    op.create_index(
        op.f("ix_public_officer_profiles_is_featured"),
        "public_officer_profiles",
        ["is_featured"],
    )
    op.create_index(
        op.f("ix_public_officer_profiles_is_visible"),
        "public_officer_profiles",
        ["is_visible"],
    )
    op.create_index(
        op.f("ix_public_officer_profiles_sort_order"),
        "public_officer_profiles",
        ["sort_order"],
    )
    op.create_index(
        op.f("ix_public_officer_profiles_user_position_id"),
        "public_officer_profiles",
        ["user_position_id"],
    )
    op.create_table(
        "public_site_pages",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("body_md", sa.Text(), nullable=False),
        sa.Column("page_kind", sa.String(length=30), server_default="standard", nullable=False),
        sa.Column("layout_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content_blocks", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("cover_image_url", sa.Text(), nullable=True),
        sa.Column("cover_image_alt", sa.String(length=200), nullable=True),
        sa.Column("seo_title", sa.String(length=120), nullable=True),
        sa.Column("seo_description", sa.String(length=300), nullable=True),
        sa.Column("nav_label", sa.String(length=60), nullable=True),
        sa.Column("nav_order", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("show_in_nav", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_published", sa.Boolean(), server_default="false", nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_public_site_pages_slug"),
    )
    op.create_index("ix_public_site_pages_nav", "public_site_pages", ["show_in_nav", "nav_order"])
    op.create_index(
        "ix_public_site_pages_published_sort",
        "public_site_pages",
        ["is_published", "sort_order"],
    )
    op.create_index(op.f("ix_public_site_pages_is_published"), "public_site_pages", ["is_published"])
    op.create_index(op.f("ix_public_site_pages_page_kind"), "public_site_pages", ["page_kind"])
    op.create_index(op.f("ix_public_site_pages_nav_order"), "public_site_pages", ["nav_order"])
    op.create_index(op.f("ix_public_site_pages_show_in_nav"), "public_site_pages", ["show_in_nav"])
    op.create_index(op.f("ix_public_site_pages_sort_order"), "public_site_pages", ["sort_order"])


def downgrade() -> None:
    op.drop_index(op.f("ix_public_site_pages_sort_order"), table_name="public_site_pages")
    op.drop_index(op.f("ix_public_site_pages_show_in_nav"), table_name="public_site_pages")
    op.drop_index(op.f("ix_public_site_pages_page_kind"), table_name="public_site_pages")
    op.drop_index(op.f("ix_public_site_pages_nav_order"), table_name="public_site_pages")
    op.drop_index(op.f("ix_public_site_pages_is_published"), table_name="public_site_pages")
    op.drop_index("ix_public_site_pages_published_sort", table_name="public_site_pages")
    op.drop_index("ix_public_site_pages_nav", table_name="public_site_pages")
    op.drop_table("public_site_pages")
    op.drop_index(op.f("ix_public_officer_profiles_user_position_id"), table_name="public_officer_profiles")
    op.drop_index(op.f("ix_public_officer_profiles_sort_order"), table_name="public_officer_profiles")
    op.drop_index(op.f("ix_public_officer_profiles_is_visible"), table_name="public_officer_profiles")
    op.drop_index(op.f("ix_public_officer_profiles_is_featured"), table_name="public_officer_profiles")
    op.drop_index("ix_public_officer_profiles_visible_sort", table_name="public_officer_profiles")
    op.drop_table("public_officer_profiles")
    op.drop_index(op.f("ix_public_links_sort_order"), table_name="public_links")
    op.drop_index(op.f("ix_public_links_is_active"), table_name="public_links")
    op.drop_index(op.f("ix_public_links_category_id"), table_name="public_links")
    op.drop_index("ix_public_links_active_sort", table_name="public_links")
    op.drop_table("public_links")
    op.drop_index("ix_public_link_categories_active_sort", table_name="public_link_categories")
    op.drop_table("public_link_categories")
    op.drop_table("public_site_settings")
