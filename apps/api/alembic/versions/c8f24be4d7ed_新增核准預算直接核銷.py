"""新增核准預算直接核銷.

Revision ID: c8f24be4d7ed
Revises: 20261004120000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c8f24be4d7ed"
down_revision: str | Sequence[str] | None = "20261004120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "finance_budget_expenses",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("budget_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("allocation_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("purpose", sa.String(length=300), nullable=False),
        sa.Column("total_amount", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("recorded_by_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["allocation_id"], ["finance_budget_allocations.id"]),
        sa.ForeignKeyConstraint(["budget_id"], ["finance_budgets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recorded_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_finance_budget_expense_budget_date",
        "finance_budget_expenses",
        ["budget_id", "entry_date"],
        unique=False,
    )
    op.create_table(
        "finance_budget_expense_items",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("expense_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("unit_price", sa.Integer(), nullable=False),
        sa.Column("tax_rate", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["expense_id"], ["finance_budget_expenses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_finance_budget_expense_item_expense",
        "finance_budget_expense_items",
        ["expense_id"],
        unique=False,
    )
    op.create_table(
        "finance_budget_expense_evidence",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("expense_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["expense_id"], ["finance_budget_expenses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_finance_budget_expense_evidence_expense",
        "finance_budget_expense_evidence",
        ["expense_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_finance_budget_expense_evidence_expense",
        table_name="finance_budget_expense_evidence",
    )
    op.drop_table("finance_budget_expense_evidence")
    op.drop_index(
        "ix_finance_budget_expense_item_expense",
        table_name="finance_budget_expense_items",
    )
    op.drop_table("finance_budget_expense_items")
    op.drop_index("ix_finance_budget_expense_budget_date", table_name="finance_budget_expenses")
    op.drop_table("finance_budget_expenses")
