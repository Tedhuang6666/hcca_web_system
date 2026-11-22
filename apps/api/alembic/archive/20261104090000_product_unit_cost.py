"""新增僅供內部使用的商品單位成本。

Revision ID: 20261104090000
Revises: 20261102160000
"""

import sqlalchemy as sa
from alembic import op

revision = "20261104090000"
down_revision = "20261102160000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("unit_cost", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_products_unit_cost_nonnegative", "products", "unit_cost IS NULL OR unit_cost >= 0"
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_unit_cost_nonnegative", "products", type_="check")
    op.drop_column("products", "unit_cost")
