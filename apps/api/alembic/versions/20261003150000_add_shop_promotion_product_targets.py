"""Add product targets and current promotion reservations to shop promotions."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261003150000"
down_revision = "20261002130000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shop_promotions",
        sa.Column("min_quantity", sa.Integer(), server_default="1", nullable=False),
    )
    op.create_table(
        "shop_promotion_products",
        sa.Column("promotion_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("product_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["promotion_id"], ["shop_promotions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("promotion_id", "product_id"),
    )
    op.create_index(
        "ix_shop_promotion_products_product_id",
        "shop_promotion_products",
        ["product_id"],
    )

    op.add_column("orders", sa.Column("promotion_id", sa.Uuid(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_orders_promotion_id_shop_promotions",
        "orders",
        "shop_promotions",
        ["promotion_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_orders_promotion_id", "orders", ["promotion_id"])
    op.execute(
        sa.text(
            """
            UPDATE orders AS order_row
            SET promotion_id = promotion.id
            FROM shop_promotions AS promotion
            WHERE order_row.promotion_id IS NULL
              AND order_row.promotion_code IS NOT NULL
              AND upper(order_row.promotion_code) = upper(promotion.code)
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_orders_promotion_id", table_name="orders")
    op.drop_constraint("fk_orders_promotion_id_shop_promotions", "orders", type_="foreignkey")
    op.drop_column("orders", "promotion_id")
    op.drop_index("ix_shop_promotion_products_product_id", table_name="shop_promotion_products")
    op.drop_table("shop_promotion_products")
    op.drop_column("shop_promotions", "min_quantity")
