"""add meeting system

Revision ID: 20260521100000
Revises: 20260520100000
Create Date: 2026-05-21 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260521100000"
down_revision: str | Sequence[str] | None = "20260520100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "meetings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("chair_name", sa.String(length=100), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("expected_voters", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quorum_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("default_pass_threshold", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("screen_token", sa.String(length=128), nullable=False),
        sa.Column("checkin_token", sa.String(length=128), nullable=False),
        sa.Column("current_agenda_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("screen_focus_title", sa.String(length=200), nullable=True),
        sa.Column("screen_focus_body", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("checkin_token"),
        sa.UniqueConstraint("screen_token"),
    )
    op.create_index("ix_meetings_checkin_token", "meetings", ["checkin_token"])
    op.create_index("ix_meetings_org_id", "meetings", ["org_id"])
    op.create_index("ix_meetings_org_status", "meetings", ["org_id", "status"])
    op.create_index("ix_meetings_screen_token", "meetings", ["screen_token"])
    op.create_index("ix_meetings_status_starts_at", "meetings", ["status", "starts_at"])

    op.create_table(
        "meeting_agenda_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("item_type", sa.String(length=20), nullable=False, server_default="manual"),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("regulation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["regulation_id"], ["regulations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_meeting_agenda_items_meeting_id", "meeting_agenda_items", ["meeting_id"]
    )
    op.create_index(
        "ix_meeting_agenda_items_meeting_order",
        "meeting_agenda_items",
        ["meeting_id", "order_index"],
    )
    op.create_foreign_key(
        "fk_meetings_current_agenda_item_id",
        "meetings",
        "meeting_agenda_items",
        ["current_agenda_item_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "meeting_attendance",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="attendee"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="expected"),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_voting_eligible", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("proxy_for_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["proxy_for_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("meeting_id", "user_id", name="uq_meeting_attendance_user"),
    )
    op.create_index(
        "ix_meeting_attendance_meeting_id", "meeting_attendance", ["meeting_id"]
    )
    op.create_index(
        "ix_meeting_attendance_meeting_status",
        "meeting_attendance",
        ["meeting_id", "status"],
    )
    op.create_index("ix_meeting_attendance_user_id", "meeting_attendance", ["user_id"])

    op.create_table(
        "meeting_votes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agenda_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("visibility", sa.String(length=20), nullable=False, server_default="named"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("pass_threshold", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["agenda_item_id"], ["meeting_agenda_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meeting_votes_agenda_item", "meeting_votes", ["agenda_item_id"])
    op.create_index("ix_meeting_votes_meeting_id", "meeting_votes", ["meeting_id"])
    op.create_index("ix_meeting_votes_meeting_status", "meeting_votes", ["meeting_id", "status"])

    op.create_table(
        "meeting_ballots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vote_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("voter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("choice", sa.String(length=20), nullable=False),
        sa.Column("cast_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["vote_id"], ["meeting_votes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["voter_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("vote_id", "voter_id", name="uq_meeting_ballot_voter"),
    )
    op.create_index("ix_meeting_ballots_vote_choice", "meeting_ballots", ["vote_id", "choice"])
    op.create_index("ix_meeting_ballots_vote_id", "meeting_ballots", ["vote_id"])
    op.create_index("ix_meeting_ballots_voter_id", "meeting_ballots", ["voter_id"])

    op.create_table(
        "meeting_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("meeting_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_type", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("agenda_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["agenda_item_id"], ["meeting_agenda_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_meeting_requests_meeting_created",
        "meeting_requests",
        ["meeting_id", "created_at"],
    )
    op.create_index("ix_meeting_requests_meeting_id", "meeting_requests", ["meeting_id"])
    op.create_index(
        "ix_meeting_requests_meeting_status",
        "meeting_requests",
        ["meeting_id", "status"],
    )
    op.create_index("ix_meeting_requests_user_id", "meeting_requests", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_meeting_requests_user_id", table_name="meeting_requests")
    op.drop_index("ix_meeting_requests_meeting_status", table_name="meeting_requests")
    op.drop_index("ix_meeting_requests_meeting_id", table_name="meeting_requests")
    op.drop_index("ix_meeting_requests_meeting_created", table_name="meeting_requests")
    op.drop_table("meeting_requests")

    op.drop_index("ix_meeting_ballots_voter_id", table_name="meeting_ballots")
    op.drop_index("ix_meeting_ballots_vote_id", table_name="meeting_ballots")
    op.drop_index("ix_meeting_ballots_vote_choice", table_name="meeting_ballots")
    op.drop_table("meeting_ballots")

    op.drop_index("ix_meeting_votes_meeting_status", table_name="meeting_votes")
    op.drop_index("ix_meeting_votes_meeting_id", table_name="meeting_votes")
    op.drop_index("ix_meeting_votes_agenda_item", table_name="meeting_votes")
    op.drop_table("meeting_votes")

    op.drop_index("ix_meeting_attendance_user_id", table_name="meeting_attendance")
    op.drop_index("ix_meeting_attendance_meeting_status", table_name="meeting_attendance")
    op.drop_index("ix_meeting_attendance_meeting_id", table_name="meeting_attendance")
    op.drop_table("meeting_attendance")

    op.drop_constraint("fk_meetings_current_agenda_item_id", "meetings", type_="foreignkey")
    op.drop_index("ix_meeting_agenda_items_meeting_order", table_name="meeting_agenda_items")
    op.drop_index("ix_meeting_agenda_items_meeting_id", table_name="meeting_agenda_items")
    op.drop_table("meeting_agenda_items")

    op.drop_index("ix_meetings_status_starts_at", table_name="meetings")
    op.drop_index("ix_meetings_screen_token", table_name="meetings")
    op.drop_index("ix_meetings_org_status", table_name="meetings")
    op.drop_index("ix_meetings_org_id", table_name="meetings")
    op.drop_index("ix_meetings_checkin_token", table_name="meetings")
    op.drop_table("meetings")
