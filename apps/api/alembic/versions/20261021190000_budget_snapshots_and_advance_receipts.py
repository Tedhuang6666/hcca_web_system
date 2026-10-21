"""預算完整版本、追加標記與代墊人。"""

import sqlalchemy as sa
from alembic import op

revision = "20261021190000"
down_revision = "20261020150000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "finance_budget_submissions",
        sa.Column("is_full_snapshot", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    for table in ("finance_budget_allocations", "finance_budget_income_items"):
        op.add_column(
            table, sa.Column("is_new", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.add_column("finance_budget_expenses", sa.Column("advanced_by_name", sa.String(120)))
    op.add_column("finance_budget_income_items", sa.Column("quantity", sa.Numeric(12, 2)))
    op.add_column("finance_budget_income_items", sa.Column("unit", sa.String(32)))
    op.add_column("finance_budget_income_items", sa.Column("unit_price", sa.Integer()))


def downgrade() -> None:
    for name in ("quantity", "unit", "unit_price"):
        op.drop_column("finance_budget_income_items", name)
    op.drop_column("finance_budget_expenses", "advanced_by_name")
    for table in ("finance_budget_allocations", "finance_budget_income_items"):
        op.drop_column(table, "is_new")
    op.drop_column("finance_budget_submissions", "is_full_snapshot")
