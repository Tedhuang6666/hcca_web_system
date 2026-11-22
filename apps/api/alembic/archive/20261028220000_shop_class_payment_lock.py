"""班聯收款後按班級與活動鎖單。

Revision ID: 20261028220000
Revises: 20261027200000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261028220000"
down_revision = "20261027200000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shop_class_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True)),
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("confirmed_by_id", postgresql.UUID(as_uuid=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["confirmed_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "uq_shop_class_payments_scope",
        "shop_class_payments",
        ["class_id", "activity_id"],
        unique=True,
        postgresql_nulls_not_distinct=True,
    )
    # 舊系統已正式入帳的班級同樣鎖單；不沿用班代的手動／預約截止。
    op.execute("""
        INSERT INTO shop_class_payments
            (id, class_id, activity_id, is_paid, confirmed_at, confirmed_by_id)
        SELECT gen_random_uuid(), class_id, activity_id, true, paid_at, paid_by_id
        FROM (
            SELECT DISTINCT ON (class_id, activity_id)
                class_id, activity_id, paid_at, paid_by_id
            FROM orders
            WHERE class_id IS NOT NULL AND is_paid = true
                AND test_product_id IS NULL
                AND lower(status::text) NOT IN ('cancelled', 'refunded')
            ORDER BY class_id, activity_id, paid_at DESC NULLS LAST, id
        ) AS paid_classes
    """)


def downgrade() -> None:
    op.drop_index("uq_shop_class_payments_scope", table_name="shop_class_payments")
    op.drop_table("shop_class_payments")
