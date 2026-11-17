"""新增商品尺寸表。

Revision ID: 20261105090000
Revises: 20261104090000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261105090000"
down_revision = "20261104090000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "size_chart", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "size_chart")
