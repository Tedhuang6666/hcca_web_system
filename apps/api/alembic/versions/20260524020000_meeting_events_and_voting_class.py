"""add meeting events and attendance voting class

Revision ID: 20260524020000
Revises: 20260524010000
Create Date: 2026-05-24 02:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260524020000"
down_revision: str | None = "20260524010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "meeting_attendance",
        sa.Column("voting_class_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_meeting_attendance_voting_class_id_school_classes",
        "meeting_attendance",
        "school_classes",
        ["voting_class_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_meeting_attendance_voting_class_id",
        "meeting_attendance",
        ["voting_class_id"],
    )
    op.create_index(
        "uq_meeting_attendance_voting_class",
        "meeting_attendance",
        ["meeting_id", "voting_class_id"],
        unique=True,
        postgresql_where=sa.text(
            "is_voting_eligible = true AND voting_class_id IS NOT NULL"
        ),
    )

    op.create_table(
        "meeting_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agenda_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["agenda_item_id"], ["meeting_agenda_items.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meeting_events_meeting_id", "meeting_events", ["meeting_id"])
    op.create_index(
        "ix_meeting_events_meeting_created",
        "meeting_events",
        ["meeting_id", "created_at"],
    )
    op.create_index(
        "ix_meeting_events_meeting_type",
        "meeting_events",
        ["meeting_id", "event_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_meeting_events_meeting_type", table_name="meeting_events")
    op.drop_index("ix_meeting_events_meeting_created", table_name="meeting_events")
    op.drop_index("ix_meeting_events_meeting_id", table_name="meeting_events")
    op.drop_table("meeting_events")

    op.drop_index("uq_meeting_attendance_voting_class", table_name="meeting_attendance")
    op.drop_index("ix_meeting_attendance_voting_class_id", table_name="meeting_attendance")
    op.drop_constraint(
        "fk_meeting_attendance_voting_class_id_school_classes",
        "meeting_attendance",
        type_="foreignkey",
    )
    op.drop_column("meeting_attendance", "voting_class_id")
