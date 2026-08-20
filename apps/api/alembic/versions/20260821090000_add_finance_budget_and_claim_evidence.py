"""新增共同預算、代墊與逐品項憑證。

Revision ID: 20260821090000
Revises: 20260818120000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260821090000"
down_revision: str | None = "20260818120000"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column("finance_journal_entries", sa.Column("proposing_org_id", UUID, nullable=True))
    op.add_column("finance_journal_entries", sa.Column("advanced_by_id", UUID, nullable=True))
    op.add_column(
        "finance_journal_entries",
        sa.Column("payment_method", sa.String(length=20), nullable=False, server_default="direct"),
    )
    op.add_column(
        "finance_journal_entries", sa.Column("reimbursement_entry_id", UUID, nullable=True)
    )
    op.create_foreign_key(
        "fk_finance_journal_proposing_org",
        "finance_journal_entries",
        "orgs",
        ["proposing_org_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_finance_journal_advanced_user",
        "finance_journal_entries",
        "users",
        ["advanced_by_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_finance_journal_reimbursement",
        "finance_journal_entries",
        "finance_journal_entries",
        ["reimbursement_entry_id"],
        ["id"],
    )
    op.create_index(
        "ix_finance_journal_proposing_org", "finance_journal_entries", ["proposing_org_id"]
    )
    op.create_index("ix_finance_journal_advanced_by", "finance_journal_entries", ["advanced_by_id"])

    op.create_table(
        "finance_budgets",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("ledger_id", UUID, sa.ForeignKey("finance_ledgers.id"), nullable=False),
        sa.Column("period_id", UUID, sa.ForeignKey("finance_fiscal_periods.id"), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("ledger_id", "period_id", name="uq_finance_budget_period"),
    )
    op.create_index("ix_finance_budgets_ledger", "finance_budgets", ["ledger_id"])
    op.create_index("ix_finance_budgets_period", "finance_budgets", ["period_id"])
    op.create_table(
        "finance_budget_submissions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "budget_id",
            UUID,
            sa.ForeignKey("finance_budgets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_finance_budget_submission_status", "finance_budget_submissions", ["budget_id", "status"]
    )
    op.create_index(
        "ix_finance_budget_submissions_status", "finance_budget_submissions", ["status"]
    )
    op.create_table(
        "finance_budget_nodes",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "budget_id",
            UUID,
            sa.ForeignKey("finance_budgets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            UUID,
            sa.ForeignKey("finance_budget_nodes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("budget_id", "parent_id", "name", name="uq_finance_budget_node_name"),
    )
    op.create_index(
        "ix_finance_budget_node_parent", "finance_budget_nodes", ["budget_id", "parent_id"]
    )
    op.create_table(
        "finance_budget_allocations",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "submission_id",
            UUID,
            sa.ForeignKey("finance_budget_submissions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_id", UUID, sa.ForeignKey("finance_budget_nodes.id"), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("proposed_by_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("proposing_org_id", UUID, sa.ForeignKey("orgs.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_finance_budget_allocation_node",
        "finance_budget_allocations",
        ["node_id", "submission_id"],
    )
    op.create_table(
        "finance_budget_allocation_revisions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "allocation_id",
            UUID,
            sa.ForeignKey("finance_budget_allocations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("previous_amount", sa.Integer(), nullable=False),
        sa.Column("next_amount", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=False),
        sa.Column("changed_by_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.add_column("finance_expense_claim_items", sa.Column("budget_node_id", UUID, nullable=True))
    op.add_column(
        "finance_expense_claim_items",
        sa.Column("budget_exception_note", sa.String(length=500), nullable=True),
    )
    op.create_foreign_key(
        "fk_finance_claim_item_budget_node",
        "finance_expense_claim_items",
        "finance_budget_nodes",
        ["budget_node_id"],
        ["id"],
    )
    op.create_index(
        "ix_finance_claim_item_budget_node", "finance_expense_claim_items", ["budget_node_id"]
    )
    op.create_table(
        "finance_expense_claim_item_evidence",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "item_id",
            UUID,
            sa.ForeignKey("finance_expense_claim_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("evidence_type", sa.String(length=20), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("uploaded_by_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_finance_expense_claim_item_evidence_item",
        "finance_expense_claim_item_evidence",
        ["item_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_finance_expense_claim_item_evidence_item",
        table_name="finance_expense_claim_item_evidence",
    )
    op.drop_table("finance_expense_claim_item_evidence")
    op.drop_index("ix_finance_claim_item_budget_node", table_name="finance_expense_claim_items")
    op.drop_constraint(
        "fk_finance_claim_item_budget_node", "finance_expense_claim_items", type_="foreignkey"
    )
    op.drop_column("finance_expense_claim_items", "budget_exception_note")
    op.drop_column("finance_expense_claim_items", "budget_node_id")
    op.drop_table("finance_budget_allocation_revisions")
    op.drop_index("ix_finance_budget_allocation_node", table_name="finance_budget_allocations")
    op.drop_table("finance_budget_allocations")
    op.drop_index("ix_finance_budget_node_parent", table_name="finance_budget_nodes")
    op.drop_table("finance_budget_nodes")
    op.drop_index("ix_finance_budget_submissions_status", table_name="finance_budget_submissions")
    op.drop_index("ix_finance_budget_submission_status", table_name="finance_budget_submissions")
    op.drop_table("finance_budget_submissions")
    op.drop_index("ix_finance_budgets_period", table_name="finance_budgets")
    op.drop_index("ix_finance_budgets_ledger", table_name="finance_budgets")
    op.drop_table("finance_budgets")
    op.drop_index("ix_finance_journal_advanced_by", table_name="finance_journal_entries")
    op.drop_index("ix_finance_journal_proposing_org", table_name="finance_journal_entries")
    op.drop_constraint(
        "fk_finance_journal_reimbursement", "finance_journal_entries", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_finance_journal_advanced_user", "finance_journal_entries", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_finance_journal_proposing_org", "finance_journal_entries", type_="foreignkey"
    )
    op.drop_column("finance_journal_entries", "reimbursement_entry_id")
    op.drop_column("finance_journal_entries", "payment_method")
    op.drop_column("finance_journal_entries", "advanced_by_id")
    op.drop_column("finance_journal_entries", "proposing_org_id")
