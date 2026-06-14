"""移除校商 org_id（校商不歸屬組織）

Revision ID: 20260614140000
Revises: 20260614130000
Create Date: 2026-06-14 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260614140000"
down_revision: str | Sequence[str] | None = "20260614130000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_product_categories_org_id", table_name="product_categories", if_exists=True)
    op.drop_constraint("product_categories_org_id_fkey", "product_categories", type_="foreignkey")
    op.drop_column("product_categories", "org_id")

    op.drop_index("ix_products_org_id", table_name="products", if_exists=True)
    op.drop_constraint("products_org_id_fkey", "products", type_="foreignkey")
    op.drop_column("products", "org_id")

    op.drop_index("ix_orders_org_id", table_name="orders", if_exists=True)
    op.drop_constraint("orders_org_id_fkey", "orders", type_="foreignkey")
    op.drop_column("orders", "org_id")


def downgrade() -> None:
    op.add_column("orders", sa.Column("org_id", sa.UUID(), nullable=True))
    op.create_foreign_key("orders_org_id_fkey", "orders", "orgs", ["org_id"], ["id"])
    op.create_index("ix_orders_org_id", "orders", ["org_id"])

    op.add_column("products", sa.Column("org_id", sa.UUID(), nullable=True))
    op.create_foreign_key("products_org_id_fkey", "products", "orgs", ["org_id"], ["id"])
    op.create_index("ix_products_org_id", "products", ["org_id"])

    op.add_column("product_categories", sa.Column("org_id", sa.UUID(), nullable=True))
    op.create_foreign_key("product_categories_org_id_fkey", "product_categories", "orgs", ["org_id"], ["id"])
    op.create_index("ix_product_categories_org_id", "product_categories", ["org_id"])
