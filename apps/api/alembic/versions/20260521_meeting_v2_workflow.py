"""meeting v2 workflow and screen state

Revision ID: 20260521_meeting_v2
Revises: 20260523100000
Create Date: 2026-05-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260521_meeting_v2"
down_revision: str | Sequence[str] | None = "20260523100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


uuid_col = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    # NOTE: meal_orders.{availability_id,pickup_slot_id,class_id} 及其 index/FK
    # 由 20260523100000 (class_meal_platform_integration) 建立；本 migration 已改接
    # 在其之後，不再重複新增，避免 DuplicateColumn 衝突。
    op.create_table(
        "meeting_attendance_sources",
        sa.Column("id", uuid_col, primary_key=True),
        sa.Column(
            "meeting_id", uuid_col, sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("source_id", uuid_col, nullable=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("role", sa.String(length=20), server_default="attendee", nullable=False),
        sa.Column("is_voting_eligible", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("imported_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_by", uuid_col, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_meeting_attendance_sources_meeting",
        "meeting_attendance_sources",
        ["meeting_id", "source_type"],
    )

    op.create_table(
        "meeting_artifact_links",
        sa.Column("id", uuid_col, primary_key=True),
        sa.Column(
            "agenda_item_id",
            uuid_col,
            sa.ForeignKey("meeting_agenda_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("artifact_type", sa.String(length=30), nullable=False),
        sa.Column("object_id", uuid_col, nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column(
            "created_by", uuid_col, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_meeting_artifact_links_item_type",
        "meeting_artifact_links",
        ["agenda_item_id", "artifact_type"],
    )

    op.create_table(
        "meeting_motions",
        sa.Column("id", uuid_col, primary_key=True),
        sa.Column(
            "meeting_id", uuid_col, sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "agenda_item_id",
            uuid_col,
            sa.ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "proposer_id", uuid_col, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("motion_type", sa.String(length=30), server_default="main", nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), server_default="pending", nullable=False),
        sa.Column(
            "vote_id",
            uuid_col,
            sa.ForeignKey("meeting_votes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_meeting_motions_agenda", "meeting_motions", ["agenda_item_id"])
    op.create_index(
        "ix_meeting_motions_meeting_status",
        "meeting_motions",
        ["meeting_id", "status"],
    )

    op.create_table(
        "meeting_decisions",
        sa.Column("id", uuid_col, primary_key=True),
        sa.Column(
            "meeting_id", uuid_col, sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "agenda_item_id",
            uuid_col,
            sa.ForeignKey("meeting_agenda_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "motion_id",
            uuid_col,
            sa.ForeignKey("meeting_motions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "vote_id",
            uuid_col,
            sa.ForeignKey("meeting_votes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="draft", nullable=False),
        sa.Column("regulation_transition_to", sa.String(length=50), nullable=True),
        sa.Column(
            "created_by", uuid_col, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_meeting_decisions_agenda", "meeting_decisions", ["agenda_item_id"])
    op.create_index(
        "ix_meeting_decisions_meeting_status",
        "meeting_decisions",
        ["meeting_id", "status"],
    )

    op.create_table(
        "meeting_screen_states",
        sa.Column(
            "meeting_id",
            uuid_col,
            sa.ForeignKey("meetings.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "agenda_item_id",
            uuid_col,
            sa.ForeignKey("meeting_agenda_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reading_mode", sa.String(length=30), server_default="agenda", nullable=False),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column(
            "active_attachment_id",
            uuid_col,
            sa.ForeignKey("meeting_agenda_attachments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scroll_position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("auto_scroll", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("scroll_speed", sa.Integer(), server_default="1", nullable=False),
        sa.Column("is_fullscreen", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "updated_by", uuid_col, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("meeting_screen_states")
    op.drop_index("ix_meeting_decisions_meeting_status", table_name="meeting_decisions")
    op.drop_index("ix_meeting_decisions_agenda", table_name="meeting_decisions")
    op.drop_table("meeting_decisions")
    op.drop_index("ix_meeting_motions_meeting_status", table_name="meeting_motions")
    op.drop_index("ix_meeting_motions_agenda", table_name="meeting_motions")
    op.drop_table("meeting_motions")
    op.drop_index("ix_meeting_artifact_links_item_type", table_name="meeting_artifact_links")
    op.drop_table("meeting_artifact_links")
    op.drop_index("ix_meeting_attendance_sources_meeting", table_name="meeting_attendance_sources")
    op.drop_table("meeting_attendance_sources")
    # meal_orders 欄位/index/FK 由 20260523100000 負責回滾，此處不再處理。
