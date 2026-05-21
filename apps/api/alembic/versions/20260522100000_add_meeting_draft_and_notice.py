"""add meeting draft confirmation, start reminder and notice document fields

Revision ID: 20260522100000
Revises: 20260521110000
Create Date: 2026-05-22 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260522100000"
down_revision: str | Sequence[str] | None = "20260521110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "meetings",
        sa.Column("bill_stage", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "meetings",
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "meetings",
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "meetings",
        sa.Column("notice_document_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_meetings_notice_document_id",
        "meetings",
        "documents",
        ["notice_document_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_meetings_notice_document_id", "meetings", type_="foreignkey")
    op.drop_column("meetings", "notice_document_id")
    op.drop_column("meetings", "reminder_sent_at")
    op.drop_column("meetings", "confirmed_at")
    op.drop_column("meetings", "bill_stage")
