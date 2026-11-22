"""add google calendar sync

Revision ID: 20260705000000
Revises: 20260702100000
Create Date: 2026-07-05 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260705000000"
down_revision: str | Sequence[str] | None = "20260702100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "org_google_calendar_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "org_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("access_token_enc", sa.Text, nullable=True),
        sa.Column("refresh_token_enc", sa.Text, nullable=True),
        sa.Column("token_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorized_email", sa.String(254), nullable=True),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "authorized_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("google_calendar_id", sa.String(256), nullable=False, server_default="primary"),
        sa.Column("sync_token", sa.String(500), nullable=True),
        sa.Column("sync_token_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_pull_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("sync_enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("org_id", name="uq_org_google_calendar_configs_org"),
    )
    op.create_index(
        "ix_org_google_calendar_configs_org_id", "org_google_calendar_configs", ["org_id"]
    )

    op.add_column(
        "calendar_events",
        sa.Column("google_event_id", sa.String(100), nullable=True),
    )
    op.create_index(
        "ix_calendar_events_google_event_id", "calendar_events", ["google_event_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_events_google_event_id", table_name="calendar_events")
    op.drop_column("calendar_events", "google_event_id")

    op.drop_index(
        "ix_org_google_calendar_configs_org_id", table_name="org_google_calendar_configs"
    )
    op.drop_table("org_google_calendar_configs")
