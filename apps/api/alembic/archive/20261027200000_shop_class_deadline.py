"""新增班級預約截止時間。

Revision ID: 20261027200000
Revises: 20261027180000
"""

import sqlalchemy as sa
from alembic import op

revision = "20261027200000"
down_revision = "20261027180000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # nullable 保留既有紀錄的立即結單語意，無須回填。
    op.add_column("shop_order_closes", sa.Column("closes_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("shop_order_closes", "closes_at")
