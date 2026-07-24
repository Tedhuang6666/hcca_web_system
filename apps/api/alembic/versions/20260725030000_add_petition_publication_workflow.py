"""add petition publication workflow

Revision ID: 20260725030000
Revises: 20260725020000
Create Date: 2026-07-25 03:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260725030000"
down_revision: str | Sequence[str] | None = "20260725020000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


petition_public_status = postgresql.ENUM(
    "not_requested",
    "pending_user",
    "pending_handler",
    "published",
    "declined",
    name="petitionpublicstatus",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    for value in ("public_requested", "public_responded", "public_confirmed", "public_declined"):
        op.execute(f"ALTER TYPE petitioneventtype ADD VALUE IF NOT EXISTS '{value}'")
    petition_public_status.create(bind, checkfirst=True)
    op.add_column(
        "petition_cases",
        sa.Column(
            "public_status",
            petition_public_status,
            server_default="not_requested",
            nullable=False,
        ),
    )
    op.add_column("petition_cases", sa.Column("public_title", sa.String(length=200), nullable=True))
    op.add_column("petition_cases", sa.Column("public_content", sa.Text(), nullable=True))
    op.add_column(
        "petition_cases",
        sa.Column("public_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "petition_cases",
        sa.Column("public_user_responded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "petition_cases",
        sa.Column("public_published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_petition_cases_public_status"),
        "petition_cases",
        ["public_status"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_petition_cases_public_status"), table_name="petition_cases")
    op.drop_column("petition_cases", "public_published_at")
    op.drop_column("petition_cases", "public_user_responded_at")
    op.drop_column("petition_cases", "public_requested_at")
    op.drop_column("petition_cases", "public_content")
    op.drop_column("petition_cases", "public_title")
    op.drop_column("petition_cases", "public_status")
    petition_public_status.drop(op.get_bind(), checkfirst=True)
