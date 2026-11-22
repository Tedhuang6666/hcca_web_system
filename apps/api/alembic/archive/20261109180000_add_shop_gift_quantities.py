"""優惠贈送件數與訂單贈品快照。

Revision ID: 20261109180000
Revises: 20261109100000
"""

import sqlalchemy as sa
from alembic import op

revision = "20261109180000"
down_revision = "20261109100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shop_promotions",
        sa.Column("gift_quantity", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "order_items",
        sa.Column("gift_quantity", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "order_items",
        sa.Column("gift_discount_amount", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("order_items", "gift_discount_amount")
    op.drop_column("order_items", "gift_quantity")
    op.drop_column("shop_promotions", "gift_quantity")
