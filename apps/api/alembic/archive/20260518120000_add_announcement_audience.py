"""add audience targeting to announcements

Revision ID: 20260518120000
Revises: 20260518100000
Create Date: 2026-05-18 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260518120000"
down_revision: str | Sequence[str] | None = "20260518100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "announcements",
        sa.Column(
            "audience_type",
            sa.String(length=20),
            nullable=False,
            server_default="all",
        ),
    )
    op.alter_column("announcements", "audience_type", server_default=None)

    op.create_table(
        "announcement_audience_orgs",
        sa.Column("announcement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("announcement_id", "org_id"),
    )

    op.create_table(
        "announcement_audience_users",
        sa.Column("announcement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("announcement_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("announcement_audience_users")
    op.drop_table("announcement_audience_orgs")
    op.drop_column("announcements", "audience_type")
