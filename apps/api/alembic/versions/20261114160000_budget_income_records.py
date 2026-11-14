"""預算實際收款紀錄。"""

import sqlalchemy as sa
from alembic import op

revision = "20261114160000"
down_revision = "20261113120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "finance_budget_income_records",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "budget_id",
            sa.UUID(),
            sa.ForeignKey("finance_budgets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "income_item_id",
            sa.UUID(),
            sa.ForeignKey("finance_budget_income_items.id"),
            nullable=False,
        ),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("recorded_by_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_finance_budget_income_record_budget",
        "finance_budget_income_records",
        ["budget_id", "entry_date"],
    )


def downgrade() -> None:
    op.drop_table("finance_budget_income_records")
