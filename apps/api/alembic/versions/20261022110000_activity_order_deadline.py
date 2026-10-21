"""活動統一商品結單時間。"""

import sqlalchemy as sa
from alembic import op

revision = "20261022110000"
down_revision = "20261022100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "activities", sa.Column("order_closes_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("activities", "order_closes_at")
