"""新增採購分析的廠商贈品數量。

Revision ID: 20261113100000
Revises: 20261111100000
"""

import sqlalchemy as sa
from alembic import op

revision = "20261113100000"
down_revision = "20261111100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("procurement_supplier_gift", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_products_supplier_gift_nonnegative", "products", "procurement_supplier_gift >= 0"
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_supplier_gift_nonnegative", "products", type_="check")
    op.drop_column("products", "procurement_supplier_gift")
