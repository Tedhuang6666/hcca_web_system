"""新增商品內部整批採購設定。

Revision ID: 20261105120000
Revises: 20261105090000
"""

import sqlalchemy as sa
from alembic import op

revision = "20261105120000"
down_revision = "20261105090000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for field in ("minimum", "stock", "reserve", "extra_cost"):
        op.add_column(
            "products",
            sa.Column(f"procurement_{field}", sa.Integer(), nullable=False, server_default="0"),
        )
    op.add_column(
        "products", sa.Column("procurement_note", sa.Text(), nullable=False, server_default="")
    )
    op.create_check_constraint(
        "ck_products_procurement_nonnegative",
        "products",
        "procurement_minimum >= 0 AND procurement_stock >= 0 "
        "AND procurement_reserve >= 0 AND procurement_extra_cost >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_procurement_nonnegative", "products", type_="check")
    for field in ("note", "extra_cost", "reserve", "stock", "minimum"):
        op.drop_column("products", f"procurement_{field}")
