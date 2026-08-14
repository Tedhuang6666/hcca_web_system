"""擴充報帳狀態、付款與預算列管欄位。

Revision ID: 20260814150000
Revises: 20260730123000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260814150000"
down_revision: str | Sequence[str] | None = "20260730123000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column(
        "finance_journal_entries",
        sa.Column("claim_status", sa.String(24), nullable=True),
    )
    op.add_column(
        "finance_journal_entries",
        sa.Column("procurement_status", sa.String(24), nullable=True),
    )
    op.add_column(
        "finance_journal_entries",
        sa.Column("procurement_updated_by_id", UUID, nullable=True),
    )
    op.add_column(
        "finance_journal_entries",
        sa.Column("procurement_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "finance_journal_entries",
        sa.Column("payment_status", sa.String(24), nullable=True),
    )
    op.add_column("finance_journal_entries", sa.Column("payment_by_id", UUID, nullable=True))
    op.add_column(
        "finance_journal_entries",
        sa.Column("payment_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "finance_journal_entries",
        sa.Column("budget_included", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "finance_journal_entries",
        sa.Column("budget_included_by_id", UUID, nullable=True),
    )
    op.add_column(
        "finance_journal_entries",
        sa.Column("budget_included_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_finance_journal_entries_claim_status",
        "finance_journal_entries",
        ["claim_status"],
    )
    for name, column in (
        ("fk_finance_journal_procurement_user", "procurement_updated_by_id"),
        ("fk_finance_journal_payment_user", "payment_by_id"),
        ("fk_finance_journal_budget_user", "budget_included_by_id"),
    ):
        op.create_foreign_key(name, "finance_journal_entries", "users", [column], ["id"])
    op.execute(
        sa.text(
            """
            UPDATE finance_journal_entries
            SET claim_status = CASE status
                WHEN 'posted' THEN 'approved'
                WHEN 'returned' THEN 'returned'
                WHEN 'pending_review' THEN 'pending_review'
                ELSE 'pending_review'
            END,
                procurement_status = 'not_required',
                payment_status = 'unpaid',
                budget_included = false
            WHERE source_type = 'expense_claim'
            """
        )
    )


def downgrade() -> None:
    for name in (
        "fk_finance_journal_budget_user",
        "fk_finance_journal_payment_user",
        "fk_finance_journal_procurement_user",
    ):
        op.drop_constraint(name, "finance_journal_entries", type_="foreignkey")
    op.drop_index(
        "ix_finance_journal_entries_claim_status",
        table_name="finance_journal_entries",
    )
    for column in (
        "budget_included_at",
        "budget_included_by_id",
        "budget_included",
        "payment_at",
        "payment_by_id",
        "payment_status",
        "procurement_updated_at",
        "procurement_updated_by_id",
        "procurement_status",
        "claim_status",
    ):
        op.drop_column("finance_journal_entries", column)
