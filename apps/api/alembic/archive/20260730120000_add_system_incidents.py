"""add persistent system incidents

Revision ID: 20260730120000
Revises: 20260729130000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260730120000"
down_revision: Union[str, None] = "20260729130000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_incidents",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("error_id", sa.String(length=64), nullable=False),
        sa.Column("fingerprint", sa.String(length=128), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False, server_default="P2"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="open"),
        sa.Column("service", sa.String(length=64), nullable=False),
        sa.Column("environment", sa.String(length=32), nullable=False),
        sa.Column("release_version", sa.String(length=128), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("trace_id", sa.String(length=64), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("automatic_recovery_attempted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("automatic_recovery_succeeded", sa.Boolean(), nullable=True),
        sa.Column("recovery_action", sa.String(length=128), nullable=True),
        sa.Column(
            "assigned_to",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("error_id"),
    )
    op.create_index(
        "ix_system_incidents_fingerprint_status",
        "system_incidents",
        ["fingerprint", "status"],
    )
    op.create_index(
        "ix_system_incidents_service_last_seen",
        "system_incidents",
        ["service", "last_seen_at"],
    )

    op.create_table(
        "system_incident_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "incident_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("system_incidents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("actor_type", sa.String(length=32), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_system_incident_events_incident_created",
        "system_incident_events",
        ["incident_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_system_incident_events_incident_created", table_name="system_incident_events")
    op.drop_table("system_incident_events")
    op.drop_index("ix_system_incidents_service_last_seen", table_name="system_incidents")
    op.drop_index("ix_system_incidents_fingerprint_status", table_name="system_incidents")
    op.drop_table("system_incidents")
