"""Allow promotions to target multiple product topics independently.

Revision ID: 20261106150000
Revises: 20261105120000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261106150000"
down_revision = "20261105120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shop_promotions",
        sa.Column("target_category_ids", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shop_promotions", "target_category_ids")
