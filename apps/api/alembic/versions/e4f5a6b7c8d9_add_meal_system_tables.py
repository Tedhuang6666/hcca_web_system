"""add_meal_system_tables
新增學餐訂購系統資料表（P6）
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e4f5a6b7c8d9"
down_revision: str | None = "d3e4f5a6b7c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 序號 ──────────────────────────────────────────────────────────────────
    op.execute("CREATE SEQUENCE IF NOT EXISTS meal_serial_seq START 1 INCREMENT 1")

    # ── 學餐訂單狀態 Enum ───────────────────────────────────────────────────────
    # 修正點 1：先定義 Enum 物件，並明確執行 create
    meal_order_status = postgresql.ENUM(
        "pending", "confirmed", "cancelled", "completed",
        name="mealorderstatus",
    )
    meal_order_status.create(op.get_bind(), checkfirst=True)

    # ── meal_vendors ───────────────────────────────────────────────────────────
    op.create_table(
        "meal_vendors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("contact_phone", sa.String(20), nullable=True),
        sa.Column("contact_email", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("org_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("orgs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_meal_vendors_name", "meal_vendors", ["name"])

    # ── menu_schedules ────────────────────────────────────────────────────────
    op.create_table(
        "menu_schedules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("meal_vendors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("order_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_closed", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
        sa.UniqueConstraint("vendor_id", "date", name="uq_vendor_date"),
    )

    # ── menu_items ────────────────────────────────────────────────────────────
    op.create_table(
        "menu_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("schedule_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("menu_schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("price", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_quantity", sa.Integer, nullable=True),
        sa.Column("is_available", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
    )

    # ── meal_orders ───────────────────────────────────────────────────────────
    op.create_table(
        "meal_orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("serial_number", sa.String(30), nullable=False, unique=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("schedule_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("menu_schedules.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("meal_vendors.id", ondelete="RESTRICT"), nullable=False),
        # 修正點 2：使用 postgresql.ENUM 並設定 create_type=False
        # 這樣就不會在建立 table 時重複觸發 CREATE TYPE
        sa.Column("status", postgresql.ENUM("pending", "confirmed", "cancelled", "completed",
                                          name="mealorderstatus", create_type=False),
                  nullable=False, server_default="pending"),
        sa.Column("total_price", sa.Integer, nullable=False, server_default="0"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "schedule_id", name="uq_user_schedule"),
    )
    op.create_index("ix_meal_orders_status", "meal_orders", ["status"])

    # ── meal_order_items ──────────────────────────────────────────────────────
    op.create_table(
        "meal_order_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("order_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("meal_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_item_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("menu_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="1"),
        sa.Column("unit_price", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
        sa.UniqueConstraint("order_id", "menu_item_id", name="uq_meal_order_item"),
    )

def downgrade() -> None:
    op.drop_table("meal_order_items")
    op.drop_table("meal_orders")
    op.drop_table("menu_items")
    op.drop_table("menu_schedules")
    op.drop_table("meal_vendors")
    op.execute("DROP TYPE IF EXISTS mealorderstatus")
    op.execute("DROP SEQUENCE IF EXISTS meal_serial_seq")
