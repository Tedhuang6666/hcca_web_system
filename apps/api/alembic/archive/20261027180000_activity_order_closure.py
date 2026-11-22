"""活動手動結單，保留既有訂單與收款。"""

import sqlalchemy as sa
from alembic import op

revision = "20261027180000"
down_revision = "20261022120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities", sa.Column("order_closed_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("activities", "order_closed_at")
