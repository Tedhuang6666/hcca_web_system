"""add meeting floor control

Revision ID: 20260524_floor
Revises: fbc1a34fda7d
Create Date: 2026-05-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260524_floor"
down_revision: str | Sequence[str] | None = "fbc1a34fda7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "meetings",
        sa.Column("default_speech_seconds", sa.Integer(), server_default="180", nullable=False),
    )
    op.add_column(
        "meetings",
        sa.Column("allow_observer_requests", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "meeting_votes",
        sa.Column(
            "threshold_type",
            sa.String(length=30),
            server_default="simple_majority",
            nullable=False,
        ),
    )
    op.create_table(
        "meeting_speech_queue_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agenda_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("speaker_name", sa.String(length=100), nullable=False),
        sa.Column("speaker_role", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="queued", nullable=False),
        sa.Column("order_index", sa.Integer(), server_default="0", nullable=False),
        sa.Column("duration_seconds", sa.Integer(), server_default="180", nullable=False),
        sa.Column("remaining_seconds", sa.Integer(), server_default="180", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
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
            ["agenda_item_id"], ["meeting_agenda_items.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["request_id"], ["meeting_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_meeting_speech_queue_items_meeting_id",
        "meeting_speech_queue_items",
        ["meeting_id"],
        unique=False,
    )
    op.create_index(
        "ix_meeting_speech_queue_items_user_id",
        "meeting_speech_queue_items",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_meeting_speech_queue_meeting_order",
        "meeting_speech_queue_items",
        ["meeting_id", "order_index"],
        unique=False,
    )
    op.create_index(
        "ix_meeting_speech_queue_meeting_status",
        "meeting_speech_queue_items",
        ["meeting_id", "status"],
        unique=False,
    )
    op.create_table(
        "meeting_timer_states",
        sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("active_speech_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="idle", nullable=False),
        sa.Column("server_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), server_default="180", nullable=False),
        sa.Column("remaining_when_paused", sa.Integer(), server_default="180", nullable=False),
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
            ["active_speech_id"], ["meeting_speech_queue_items.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("meeting_id"),
    )
    op.execute(
        """
        INSERT INTO meeting_timer_states (
            meeting_id,
            status,
            duration_seconds,
            remaining_when_paused,
            created_at,
            updated_at
        )
        SELECT id, 'idle', default_speech_seconds, default_speech_seconds, now(), now()
        FROM meetings
        ON CONFLICT (meeting_id) DO NOTHING
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("meeting_timer_states")
    op.drop_index("ix_meeting_speech_queue_meeting_status", table_name="meeting_speech_queue_items")
    op.drop_index("ix_meeting_speech_queue_meeting_order", table_name="meeting_speech_queue_items")
    op.drop_index("ix_meeting_speech_queue_items_user_id", table_name="meeting_speech_queue_items")
    op.drop_index(
        "ix_meeting_speech_queue_items_meeting_id", table_name="meeting_speech_queue_items"
    )
    op.drop_table("meeting_speech_queue_items")
    op.drop_column("meeting_votes", "threshold_type")
    op.drop_column("meetings", "allow_observer_requests")
    op.drop_column("meetings", "default_speech_seconds")
