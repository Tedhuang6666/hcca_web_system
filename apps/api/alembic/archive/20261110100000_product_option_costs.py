"""內部採購選項成本。

Revision ID: 20261110100000
Revises: 20261109220000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261110100000"
down_revision = "20261109220000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "procurement_option_costs", postgresql.JSONB(), nullable=False, server_default="{}"
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "procurement_option_costs")
