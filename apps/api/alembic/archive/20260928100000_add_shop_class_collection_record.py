"""區分班代收款紀錄與班聯會正式繳費"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260928100000"
down_revision: str | Sequence[str] | None = "20260926100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("is_class_collected", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("orders", sa.Column("class_collected_at", sa.DateTime(timezone=True)))
    op.add_column("orders", sa.Column("class_collected_by_id", postgresql.UUID(as_uuid=True)))
    op.create_index("ix_orders_is_class_collected", "orders", ["is_class_collected"])
    op.create_foreign_key(
        "fk_orders_class_collected_by_id_users",
        "orders",
        "users",
        ["class_collected_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # 舊版由班代直接標示正式繳費的訂單，保留其原有的班級收款紀錄。
    op.execute(
        """
        UPDATE orders AS o
        SET is_class_collected = true,
            class_collected_at = o.paid_at,
            class_collected_by_id = o.paid_by_id
        WHERE o.is_paid = true
          AND o.class_id IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM class_cadres AS cc
              WHERE cc.class_id = o.class_id AND cc.user_id = o.paid_by_id
          )
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_orders_class_collected_by_id_users", "orders", type_="foreignkey")
    op.drop_index("ix_orders_is_class_collected", table_name="orders")
    op.drop_column("orders", "class_collected_by_id")
    op.drop_column("orders", "class_collected_at")
    op.drop_column("orders", "is_class_collected")
