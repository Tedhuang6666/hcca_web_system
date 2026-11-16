"""組織預購表單來源、匯入帳本及外部訂購人。

Revision ID: 20261109220000
Revises: 20261109180000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261109220000"
down_revision = "20261109180000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("orders", "user_id", existing_type=sa.Uuid(), nullable=True)
    op.create_check_constraint(
        "ck_orders_external_buyer",
        "orders",
        "user_id IS NOT NULL OR (assistance_scope = 'sheet_import' "
        "AND buyer_name IS NOT NULL AND buyer_office IS NOT NULL)",
    )
    op.create_table(
        "shop_sheet_sources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("spreadsheet_id", sa.String(200), nullable=False),
        sa.Column("sheet_name", sa.String(100), nullable=False),
        sa.Column(
            "category_id",
            sa.Uuid(),
            sa.ForeignKey("product_categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("config", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(500)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("spreadsheet_id", "sheet_name"),
    )
    op.create_table(
        "shop_sheet_rows",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "source_id",
            sa.Uuid(),
            sa.ForeignKey("shop_sheet_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("response_key", sa.String(64), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.String(500)),
        sa.Column("order_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("source_id", "response_key"),
    )
    op.create_index("ix_shop_sheet_rows_source_id", "shop_sheet_rows", ["source_id"])


def downgrade() -> None:
    # 不刪除已成立訂單或偽造帳號；有外部訂單時禁止退回必須綁帳號的結構。
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM orders WHERE user_id IS NULL")):
        raise RuntimeError("仍有外部組織訂單，請先備份並遷移訂購人後再 downgrade")
    op.drop_table("shop_sheet_rows")
    op.drop_table("shop_sheet_sources")
    op.drop_constraint("ck_orders_external_buyer", "orders", type_="check")
    op.alter_column("orders", "user_id", existing_type=sa.Uuid(), nullable=False)
