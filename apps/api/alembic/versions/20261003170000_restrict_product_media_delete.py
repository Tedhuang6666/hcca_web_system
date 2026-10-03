"""Prevent deleting products that still have media rows by raw SQL.

Revision ID: 20261003170000
Revises: 20261003160000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "20261003170000"
down_revision: str | Sequence[str] | None = "20261003160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("product_media_product_id_fkey", "product_media", type_="foreignkey")
    op.create_foreign_key(
        "product_media_product_id_fkey",
        "product_media",
        "products",
        ["product_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("product_media_product_id_fkey", "product_media", type_="foreignkey")
    op.create_foreign_key(
        "product_media_product_id_fkey",
        "product_media",
        "products",
        ["product_id"],
        ["id"],
        ondelete="CASCADE",
    )
