"""新增預算憑證與完整修訂內容

Revision ID: 20260903090000
Revises: 20260830100000
Create Date: 2026-09-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260903090000"
down_revision: str | Sequence[str] | None = "20260830100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "finance_budget_allocation_revisions",
        sa.Column("previous_details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "finance_budget_allocation_revisions",
        sa.Column("next_details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_table(
        "finance_budget_allocation_evidence",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("allocation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("uploaded_by_id", postgresql.UUID(as_uuid=True), nullable=False),
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
            ["allocation_id"], ["finance_budget_allocations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_finance_budget_evidence_allocation",
        "finance_budget_allocation_evidence",
        ["allocation_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_finance_budget_evidence_allocation",
        table_name="finance_budget_allocation_evidence",
    )
    op.drop_table("finance_budget_allocation_evidence")
    op.drop_column("finance_budget_allocation_revisions", "next_details")
    op.drop_column("finance_budget_allocation_revisions", "previous_details")
