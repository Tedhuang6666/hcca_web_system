"""Add persistent ordering for products.

Revision ID: 20261126010000
Revises: 20261123010000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261126010000"
down_revision: str | None = "20261123010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
    )
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id, row_number() OVER (
                    PARTITION BY category_id ORDER BY created_at, id
                ) - 1 AS position
                FROM products
                WHERE series_id IS NULL
            )
            UPDATE products AS product
            SET sort_order = ranked.position::integer
            FROM ranked
            WHERE product.id = ranked.id
            """
        )
    )
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id, row_number() OVER (
                    PARTITION BY series_id ORDER BY created_at, id
                ) - 1 AS position
                FROM products
                WHERE series_id IS NOT NULL
            )
            UPDATE products AS product
            SET sort_order = ranked.position::integer
            FROM ranked
            WHERE product.id = ranked.id
            """
        )
    )


def downgrade() -> None:
    op.drop_column("products", "sort_order")
