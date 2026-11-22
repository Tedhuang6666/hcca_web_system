"""Add income forecasts and council approval date to budget submissions."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261004190000"
down_revision: str | Sequence[str] | None = "c8f24be4d7ed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "finance_budget_submissions",
        sa.Column("council_approved_on", sa.Date(), nullable=True),
    )
    op.create_table(
        "finance_budget_income_items",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("submission_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("category", sa.String(length=160), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source_row_number", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["submission_id"], ["finance_budget_submissions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_finance_budget_income_submission",
        "finance_budget_income_items",
        ["submission_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_finance_budget_income_submission", table_name="finance_budget_income_items"
    )
    op.drop_table("finance_budget_income_items")
    op.drop_column("finance_budget_submissions", "council_approved_on")
