"""add class assistance markers to orders

Revision ID: 20260531173000
Revises: fbc1a34fda7d
Create Date: 2026-05-31 17:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260531173000"
down_revision: str | Sequence[str] | None = "fbc1a34fda7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "meal_orders",
        sa.Column(
            "assistance_scope",
            sa.String(length=30),
            server_default="self",
            nullable=False,
        ),
    )
    op.add_column(
        "meal_orders",
        sa.Column("assisted_by_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_meal_orders_assistance_scope", "meal_orders", ["assistance_scope"])
    op.create_index("ix_meal_orders_assisted_by_id", "meal_orders", ["assisted_by_id"])
    op.create_foreign_key(
        "fk_meal_orders_assisted_by_id_users",
        "meal_orders",
        "users",
        ["assisted_by_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "orders",
        sa.Column(
            "assistance_scope",
            sa.String(length=30),
            server_default="self",
            nullable=False,
        ),
    )
    op.add_column("orders", sa.Column("assisted_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_orders_assistance_scope", "orders", ["assistance_scope"])
    op.create_index("ix_orders_assisted_by_id", "orders", ["assisted_by_id"])
    op.create_foreign_key(
        "fk_orders_assisted_by_id_users",
        "orders",
        "users",
        ["assisted_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_orders_assisted_by_id_users", "orders", type_="foreignkey")
    op.drop_index("ix_orders_assisted_by_id", table_name="orders")
    op.drop_index("ix_orders_assistance_scope", table_name="orders")
    op.drop_column("orders", "assisted_by_id")
    op.drop_column("orders", "assistance_scope")

    op.drop_constraint("fk_meal_orders_assisted_by_id_users", "meal_orders", type_="foreignkey")
    op.drop_index("ix_meal_orders_assisted_by_id", table_name="meal_orders")
    op.drop_index("ix_meal_orders_assistance_scope", table_name="meal_orders")
    op.drop_column("meal_orders", "assisted_by_id")
    op.drop_column("meal_orders", "assistance_scope")
