"""add calendar system

Revision ID: 20260529110000
Revises: 20260529090000, 20260529100000
Create Date: 2026-05-29 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260529110000"
down_revision: str | Sequence[str] | None = ("20260529090000", "20260529100000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "calendar_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("event_type", sa.String(length=30), server_default="activity", nullable=False),
        sa.Column("status", sa.String(length=20), server_default="confirmed", nullable=False),
        sa.Column("visibility", sa.String(length=20), server_default="org", nullable=False),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("all_day", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("source_meeting_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_module", sa.String(length=40), nullable=True),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_key", sa.String(length=80), nullable=True),
        sa.Column("href", sa.String(length=500), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_module", "source_id", "source_key", name="uq_calendar_events_source"),
        sa.UniqueConstraint("source_meeting_id", name="uq_calendar_events_source_meeting"),
    )
    op.create_index("ix_calendar_events_event_type", "calendar_events", ["event_type"])
    op.create_index("ix_calendar_events_is_active", "calendar_events", ["is_active"])
    op.create_index("ix_calendar_events_org_id", "calendar_events", ["org_id"])
    op.create_index(
        "ix_calendar_events_org_range", "calendar_events", ["org_id", "starts_at", "ends_at"]
    )
    op.create_index("ix_calendar_events_range", "calendar_events", ["starts_at", "ends_at"])
    op.create_index(
        "ix_calendar_events_source_meeting_id", "calendar_events", ["source_meeting_id"]
    )
    op.create_index(
        "ix_calendar_events_source", "calendar_events", ["source_module", "source_id", "source_key"]
    )
    op.create_index("ix_calendar_events_source_id", "calendar_events", ["source_id"])
    op.create_index("ix_calendar_events_source_module", "calendar_events", ["source_module"])
    op.create_index("ix_calendar_events_status", "calendar_events", ["status"])
    op.create_index("ix_calendar_events_type_status", "calendar_events", ["event_type", "status"])
    op.create_index("ix_calendar_events_visibility", "calendar_events", ["visibility"])

    op.create_table(
        "calendar_event_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=20), server_default="required", nullable=False),
        sa.Column("response", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "user_id", name="uq_calendar_event_participant_user"),
    )
    op.create_index(
        "ix_calendar_event_participants_user",
        "calendar_event_participants",
        ["user_id", "response"],
    )
    op.create_index(
        "ix_calendar_event_participants_user_id", "calendar_event_participants", ["user_id"]
    )

    op.create_table(
        "calendar_event_checklist_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignee_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_done", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_event_checklist_event_done",
        "calendar_event_checklist_items",
        ["event_id", "is_done"],
    )
    op.create_index(
        "ix_calendar_event_checklist_items_assignee_id",
        "calendar_event_checklist_items",
        ["assignee_id"],
    )

    op.create_table(
        "calendar_event_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("link_type", sa.String(length=30), nullable=False),
        sa.Column("object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_event_links_event_type",
        "calendar_event_links",
        ["event_id", "link_type"],
    )

    op.execute(
        sa.text(
            """
            INSERT INTO calendar_events (
                id, org_id, title, description, event_type, status, visibility, location,
                starts_at, ends_at, all_day, source_meeting_id, source_module, source_id,
                source_key, href, created_by, updated_by, is_active,
                created_at, updated_at
            )
            SELECT
                gen_random_uuid(), org_id, title, description, 'formal_meeting',
                CASE WHEN status IN ('closed', 'archived') THEN 'done' ELSE 'confirmed' END,
                'org', location, starts_at, ends_at, false, id, 'meeting', id,
                'starts_at', '/meetings/' || id::text, created_by, created_by, true,
                created_at, updated_at
            FROM meetings
            WHERE starts_at IS NOT NULL
            ON CONFLICT (source_meeting_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO calendar_event_participants (id, event_id, user_id, role, response)
            SELECT gen_random_uuid(), id, created_by, 'owner', 'pending'
            FROM calendar_events
            WHERE source_meeting_id IS NOT NULL
            ON CONFLICT (event_id, user_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO calendar_event_links (id, event_id, link_type, object_id, title, url, created_by)
            SELECT
                gen_random_uuid(), id, 'meeting', source_meeting_id, title,
                '/meetings/' || source_meeting_id::text, created_by
            FROM calendar_events
            WHERE source_meeting_id IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_event_links_event_type", table_name="calendar_event_links")
    op.drop_table("calendar_event_links")
    op.drop_index(
        "ix_calendar_event_checklist_items_assignee_id",
        table_name="calendar_event_checklist_items",
    )
    op.drop_index(
        "ix_calendar_event_checklist_event_done",
        table_name="calendar_event_checklist_items",
    )
    op.drop_table("calendar_event_checklist_items")
    op.drop_index(
        "ix_calendar_event_participants_user_id", table_name="calendar_event_participants"
    )
    op.drop_index("ix_calendar_event_participants_user", table_name="calendar_event_participants")
    op.drop_table("calendar_event_participants")
    op.drop_index("ix_calendar_events_visibility", table_name="calendar_events")
    op.drop_index("ix_calendar_events_type_status", table_name="calendar_events")
    op.drop_index("ix_calendar_events_status", table_name="calendar_events")
    op.drop_index("ix_calendar_events_source_meeting_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_source_module", table_name="calendar_events")
    op.drop_index("ix_calendar_events_source_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_source", table_name="calendar_events")
    op.drop_index("ix_calendar_events_range", table_name="calendar_events")
    op.drop_index("ix_calendar_events_org_range", table_name="calendar_events")
    op.drop_index("ix_calendar_events_org_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_is_active", table_name="calendar_events")
    op.drop_index("ix_calendar_events_event_type", table_name="calendar_events")
    op.drop_table("calendar_events")
