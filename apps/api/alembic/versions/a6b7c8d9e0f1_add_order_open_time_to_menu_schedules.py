"""add_order_open_time_to_menu_schedules

新增 menu_schedules.order_open_time 欄位，讓商家可設定訂餐開放時間。
NULL 代表立即開放（維持現有行為）。

Revision ID: a6b7c8d9e0f1
Revises: f5a6b7c8d9e0
Create Date: 2026-04-19 10:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

revision = "a6b7c8d9e0f1"
down_revision = "f5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "menu_schedules",
        sa.Column("order_open_time", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("menu_schedules", "order_open_time")
