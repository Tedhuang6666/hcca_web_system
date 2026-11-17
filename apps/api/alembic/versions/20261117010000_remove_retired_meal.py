"""移除停用的學餐資料表；歷史應收款與稽核紀錄保留。

Revision ID: 20261117010000
Revises: 20261115160000
"""

from alembic import op

revision = "20261117010000"
down_revision = "20261115160000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 不使用 CASCADE：若日後發現未知外鍵，應停止並檢查，避免連帶刪除。
    for name in (
        "meal_class_pickup_codes",
        "meal_order_items",
        "meal_orders",
        "menu_items",
        "menu_schedules",
        "meal_pickup_slots",
        "meal_product_availabilities",
        "meal_products",
        "meal_vendor_applications",
        "meal_vendor_managers",
        "meal_vendors",
    ):
        op.drop_table(name)
    op.execute("DROP SEQUENCE meal_serial_seq")
    op.execute("DROP TYPE mealorderstatus")


def downgrade() -> None:
    raise RuntimeError("學餐資料已移除；降版須以升級前備份復原，不可用空表假裝還原資料。")
