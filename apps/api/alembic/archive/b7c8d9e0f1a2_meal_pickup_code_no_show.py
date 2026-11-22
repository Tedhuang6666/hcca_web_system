"""meal_pickup_code_no_show

新增 meal_orders 三欄位：
- pickup_code     VARCHAR(5)  UNIQUE  取餐短代碼（5 位數字）
- reminder_sent_at TIMESTAMPTZ         未取餐第一次提醒時間
- is_no_show      BOOLEAN     DEFAULT FALSE  已標記未取餐

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-04-19 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b7c8d9e0f1a2"
down_revision = "a6b7c8d9e0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. 新增取餐碼欄位（暫時允許 NULL 以便後續更新舊資料） ────────────────
    op.add_column(
        "meal_orders",
        sa.Column("pickup_code", sa.String(5), nullable=True),
    )

    # ── 2. 修正重點：使用子查詢更新 pickup_code (解決 WindowingError) ───
    # 我們先在子查詢計算好 ROW_NUMBER，再透過 FROM 子句映射回原表
    op.execute("""
        UPDATE meal_orders
        SET pickup_code = sub.new_code
        FROM (
            SELECT
                id,
                LPAD(ROW_NUMBER() OVER (ORDER BY created_at)::TEXT, 5, '0') as new_code
            FROM meal_orders
        ) AS sub
        WHERE meal_orders.id = sub.id
        AND meal_orders.pickup_code IS NULL
    """)

    # ── 3. 設定約束（Constraint） ──────────────────────────────────────────
    # 資料填補完畢後，將欄位改為 NOT NULL 並加上唯一限制
    op.alter_column("meal_orders", "pickup_code", nullable=False)
    op.create_unique_constraint("uq_meal_orders_pickup_code", "meal_orders", ["pickup_code"])
    op.create_index("ix_meal_orders_pickup_code", "meal_orders", ["pickup_code"])

    # ── 4. 新增其餘欄位 ────────────────────────────────────────────────────
    # 未取餐提醒時間
    op.add_column(
        "meal_orders",
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 未取餐標記
    op.add_column(
        "meal_orders",
        sa.Column("is_no_show", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_index("ix_meal_orders_pickup_code", table_name="meal_orders")
    op.drop_constraint("uq_meal_orders_pickup_code", "meal_orders", type_="unique")
    op.drop_column("meal_orders", "is_no_show")
    op.drop_column("meal_orders", "reminder_sent_at")
    op.drop_column("meal_orders", "pickup_code")
