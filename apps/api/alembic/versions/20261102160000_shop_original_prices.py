"""商品與規格選項原價。

Revision ID: 20261102160000
Revises: 20261102000000
"""

import sqlalchemy as sa
from alembic import op

revision = "20261102160000"
down_revision = "20261102000000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("original_price", sa.Integer(), nullable=True))
    op.add_column(
        "product_variant_options", sa.Column("original_price_delta", sa.Integer(), nullable=True)
    )
    op.create_check_constraint(
        "ck_products_original_price",
        "products",
        "original_price IS NULL OR original_price >= price",
    )
    op.create_check_constraint(
        "ck_product_variant_options_original_price_delta",
        "product_variant_options",
        "original_price_delta IS NULL OR original_price_delta >= price_delta",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_product_variant_options_original_price_delta", "product_variant_options", type_="check"
    )
    op.drop_constraint("ck_products_original_price", "products", type_="check")
    op.drop_column("product_variant_options", "original_price_delta")
    op.drop_column("products", "original_price")
