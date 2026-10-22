"""商品測試狀態與獨立測試訂單。"""

import sqlalchemy as sa
from alembic import op

revision = "20261022120000"
down_revision = "20261022110000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE productstatus ADD VALUE IF NOT EXISTS 'TESTING'")
    op.add_column("orders", sa.Column("test_product_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_orders_test_product_id_products",
        "orders",
        "products",
        ["test_product_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_orders_test_product_id", "orders", ["test_product_id"])


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM orders WHERE test_product_id IS NOT NULL")
    ):
        raise RuntimeError("請先正式開放測試商品並清除測試訂單，再執行降版")
    # 避免舊程式讀到不認得的狀態，且不在降版時刪除測試訂單。
    op.execute("UPDATE products SET status = 'DRAFT' WHERE status::text = 'TESTING'")
    op.drop_index("ix_orders_test_product_id", table_name="orders")
    op.drop_constraint("fk_orders_test_product_id_products", "orders", type_="foreignkey")
    op.drop_column("orders", "test_product_id")
    # PostgreSQL enum 不支援直接移除值；保留未使用的 TESTING 值。
