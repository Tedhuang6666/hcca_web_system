"""新增公開文章閱讀統計

Revision ID: 20260830100000
Revises: 20260829170000
Create Date: 2026-08-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260830100000"
down_revision: str | Sequence[str] | None = "20260829170000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "public_site_page_views",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("page_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("visitor_hash", sa.String(length=64), nullable=False),
        sa.Column("device_class", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["page_id"], ["public_site_pages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_public_site_page_views_created_at",
        "public_site_page_views",
        ["created_at"],
    )
    op.create_index(
        "ix_public_site_page_views_page_created_at",
        "public_site_page_views",
        ["page_id", "created_at"],
    )
    op.create_index(
        "ix_public_site_page_views_visitor_created_at",
        "public_site_page_views",
        ["visitor_hash", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_public_site_page_views_visitor_created_at",
        table_name="public_site_page_views",
    )
    op.drop_index(
        "ix_public_site_page_views_page_created_at",
        table_name="public_site_page_views",
    )
    op.drop_index(
        "ix_public_site_page_views_created_at",
        table_name="public_site_page_views",
    )
    op.drop_table("public_site_page_views")
