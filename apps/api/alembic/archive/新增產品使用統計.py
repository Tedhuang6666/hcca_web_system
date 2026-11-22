"""新增產品使用統計

Revision ID: 20260720_product_analytics
Revises: b9c0d1e2f3a4
Create Date: 2026-07-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260720_product_analytics"
down_revision: str | Sequence[str] | None = "b9c0d1e2f3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "analytics_page_views",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_analytics_page_views_created_at", "analytics_page_views", ["created_at"]
    )
    op.create_index(
        "ix_analytics_page_views_path_created_at",
        "analytics_page_views",
        ["path", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_analytics_page_views_path_created_at", table_name="analytics_page_views")
    op.drop_index("ix_analytics_page_views_created_at", table_name="analytics_page_views")
    op.drop_table("analytics_page_views")
