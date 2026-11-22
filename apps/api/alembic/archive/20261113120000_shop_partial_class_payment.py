"""記錄班級部分收款與整班尾款。

Revision ID: 20261113120000
Revises: 20261113110000
"""

import sqlalchemy as sa
from alembic import op

revision = "20261113120000"
down_revision = "20261113110000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shop_class_collections",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "order_id", sa.UUID(), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_shop_class_collections_order_id", "shop_class_collections", ["order_id"])
    op.add_column(
        "orders", sa.Column("received_amount", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "orders",
        sa.Column("is_class_balance", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE orders SET received_amount = total_price WHERE is_paid = true")
    # 保留財務端先前已登記的部分付款。
    op.execute("""
        UPDATE orders SET received_amount = receivables.paid_amount
        FROM receivables
        WHERE receivables.source_type = 'shop_order'
            AND receivables.source_id = orders.id AND orders.is_paid = false
            AND receivables.paid_amount > 0
    """)


def downgrade() -> None:
    op.drop_table("shop_class_collections")
    op.drop_column("orders", "is_class_balance")
    op.drop_column("orders", "received_amount")
