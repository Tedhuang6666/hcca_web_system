"""add unique partner checkins and submission google maps url

Revision ID: 20260725010000
Revises: 20260724120000
Create Date: 2026-07-25 01:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260725010000"
down_revision: str | Sequence[str] | None = "20260724120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("partner_submissions", sa.Column("google_maps_url", sa.Text(), nullable=True))
    op.create_table(
        "partner_checkins",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("business_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "user_id", name="uq_partner_checkin_user"),
    )
    op.create_index(
        "ix_partner_checkins_business_id", "partner_checkins", ["business_id"], unique=False
    )
    op.create_index("ix_partner_checkins_user_id", "partner_checkins", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_partner_checkins_user_id", table_name="partner_checkins")
    op.drop_index("ix_partner_checkins_business_id", table_name="partner_checkins")
    op.drop_table("partner_checkins")
    op.drop_column("partner_submissions", "google_maps_url")
