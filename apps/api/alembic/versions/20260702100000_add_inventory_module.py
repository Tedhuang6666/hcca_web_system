"""add inventory module tables

Revision ID: 20260702100000
Revises: 20260701200000
Create Date: 2026-07-02 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260702100000"
down_revision: str | Sequence[str] | None = "20260701200000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 物資類別
    op.create_table(
        "inventory_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color", sa.String(7), nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_categories_org_id", "inventory_categories", ["org_id"])
    op.create_index("ix_inventory_categories_is_active", "inventory_categories", ["is_active"])

    # 物資品項
    op.create_table(
        "inventory_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("inventory_categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("unit", sa.String(20), nullable=False, server_default="個"),
        sa.Column("item_type", sa.String(20), nullable=False, server_default="consumable"),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("low_stock_threshold", sa.Integer, nullable=False, server_default="0"),
        sa.Column("location", sa.String(200), nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("loan_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("loan_item_categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_items_org_id", "inventory_items", ["org_id"])
    op.create_index("ix_inventory_items_category_id", "inventory_items", ["category_id"])
    op.create_index("ix_inventory_items_item_type", "inventory_items", ["item_type"])
    op.create_index("ix_inventory_items_is_active", "inventory_items", ["is_active"])
    op.create_index("ix_inventory_items_name", "inventory_items", ["name"])
    op.create_index("ix_inventory_items_loan_item_id", "inventory_items", ["loan_item_id"])

    # 庫存異動日誌
    op.create_table(
        "inventory_transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("txn_type", sa.String(20), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("quantity_before", sa.Integer, nullable=False),
        sa.Column("quantity_after", sa.Integer, nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_transactions_item_id", "inventory_transactions", ["item_id"])
    op.create_index("ix_inventory_transactions_txn_type", "inventory_transactions", ["txn_type"])
    op.create_index("ix_inventory_transactions_created_at", "inventory_transactions", ["created_at"])
    op.create_index("ix_inventory_transactions_created_by_id", "inventory_transactions", ["created_by_id"])

    # 採購申請主表
    op.create_table(
        "inventory_procurements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("estimated_amount", sa.Integer, nullable=True),
        sa.Column("requester_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requester_notes", sa.Text, nullable=True),
        sa.Column("reviewer_notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_procurements_org_id", "inventory_procurements", ["org_id"])
    op.create_index("ix_inventory_procurements_status", "inventory_procurements", ["status"])
    op.create_index("ix_inventory_procurements_requester_id", "inventory_procurements", ["requester_id"])

    # 採購明細
    op.create_table(
        "inventory_procurement_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("procurement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("inventory_procurements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("item_name", sa.String(200), nullable=False),
        sa.Column("item_unit", sa.String(20), nullable=False, server_default="個"),
        sa.Column("quantity_requested", sa.Integer, nullable=False),
        sa.Column("quantity_received", sa.Integer, nullable=False, server_default="0"),
        sa.Column("estimated_unit_price", sa.Integer, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_procurement_items_procurement_id", "inventory_procurement_items", ["procurement_id"])
    op.create_index("ix_inventory_procurement_items_item_id", "inventory_procurement_items", ["item_id"])


def downgrade() -> None:
    op.drop_table("inventory_procurement_items")
    op.drop_table("inventory_procurements")
    op.drop_table("inventory_transactions")
    op.drop_table("inventory_items")
    op.drop_table("inventory_categories")
