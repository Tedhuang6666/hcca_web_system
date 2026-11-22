"""新增商品詳情圖片集

Revision ID: 20260929130000
Revises: 20260928110000
Create Date: 2026-09-29 13:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260929130000"
down_revision: str | None = "20260928110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "product_media",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("image_url", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("kind IN ('product', 'model')", name="ck_product_media_kind"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_product_media_product_sort",
        "product_media",
        ["product_id", "sort_order"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_product_media_product_sort", table_name="product_media")
    op.drop_table("product_media")
