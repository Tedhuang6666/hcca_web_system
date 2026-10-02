"""為商品設定每位使用者的累計購買上限。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261002120000"
down_revision = "20261001100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("max_quantity_per_user", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_products_max_quantity_per_user_positive",
        "products",
        "max_quantity_per_user IS NULL OR max_quantity_per_user >= 1",
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_max_quantity_per_user_positive", "products", type_="check")
    op.drop_column("products", "max_quantity_per_user")
