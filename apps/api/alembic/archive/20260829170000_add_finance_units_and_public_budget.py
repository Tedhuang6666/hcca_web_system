"""補強預算明細、公開檢視與小數數量。

Revision ID: 20260829170000
Revises: 20260821090000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260829170000"
down_revision: str | None = "20260821090000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "finance_budgets",
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "finance_budget_allocations", sa.Column("quantity", sa.Numeric(12, 2), nullable=True)
    )
    op.add_column(
        "finance_budget_allocations", sa.Column("unit", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "finance_budget_allocations", sa.Column("unit_price", sa.Integer(), nullable=True)
    )
    op.alter_column(
        "finance_expense_claim_items",
        "quantity",
        existing_type=sa.Integer(),
        type_=sa.Numeric(12, 2),
        existing_nullable=False,
        postgresql_using="quantity::numeric(12, 2)",
    )
    op.add_column(
        "finance_expense_claim_items",
        sa.Column("unit", sa.String(length=32), nullable=False, server_default="項"),
    )
    op.alter_column("finance_expense_claim_items", "unit", server_default=None)
    op.alter_column("finance_budgets", "is_public", server_default=None)


def downgrade() -> None:
    op.drop_column("finance_expense_claim_items", "unit")
    op.alter_column(
        "finance_expense_claim_items",
        "quantity",
        existing_type=sa.Numeric(12, 2),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="quantity::integer",
    )
    op.drop_column("finance_budget_allocations", "unit_price")
    op.drop_column("finance_budget_allocations", "unit")
    op.drop_column("finance_budget_allocations", "quantity")
    op.drop_column("finance_budgets", "is_public")
