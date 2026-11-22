"""add loan module tables

Revision ID: 20260701200000
Revises: 20260701103000
Create Date: 2026-07-01 20:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260701200000"
down_revision: str | Sequence[str] | None = "20260701103000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "loan_item_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("default_due_days", sa.Integer, nullable=False, server_default="7"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_loan_item_categories_org_id", "loan_item_categories", ["org_id"])
    op.create_index("ix_loan_item_categories_is_active", "loan_item_categories", ["is_active"])

    op.create_table(
        "loan_units",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("loan_item_categories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unit_code", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="available"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("item_id", "unit_code", name="uq_loan_unit_code_per_item"),
    )
    op.create_index("ix_loan_units_item_id", "loan_units", ["item_id"])
    op.create_index("ix_loan_units_status", "loan_units", ["status"])

    op.create_table(
        "loan_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("loan_units.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("borrower_name", sa.String(100), nullable=False),
        sa.Column("borrower_student_id", sa.String(20), nullable=True),
        sa.Column("borrower_email", sa.String(255), nullable=True),
        sa.Column("borrower_contact", sa.String(50), nullable=True),
        sa.Column("borrowed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("reminder_sent_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_reminder_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("handled_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("return_handled_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_loan_records_unit_id", "loan_records", ["unit_id"])
    op.create_index("ix_loan_records_status", "loan_records", ["status"])
    op.create_index("ix_loan_records_due_at", "loan_records", ["due_at"])
    op.create_index("ix_loan_records_handled_by_id", "loan_records", ["handled_by_id"])


def downgrade() -> None:
    op.drop_table("loan_records")
    op.drop_table("loan_units")
    op.drop_table("loan_item_categories")
