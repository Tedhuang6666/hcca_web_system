"""add realtime election counting

Revision ID: 20260605election
Revises: 20260604governance
Create Date: 2026-06-05 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260605election"
down_revision: str | Sequence[str] | None = "20260604governance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "elections",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_elections_title", "elections", ["title"])
    op.create_index("ix_elections_status", "elections", ["status"])
    op.create_table(
        "election_candidates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("election_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("color", sa.String(20), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["election_id"], ["elections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("election_id", "number", name="uq_election_candidate_number"),
    )
    op.create_index("ix_election_candidates_election_id", "election_candidates", ["election_id"])
    op.create_table(
        "election_ballot_boxes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("election_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("expected_total_votes", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["election_id"], ["elections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("election_id", "name", name="uq_election_ballot_box_name"),
    )
    op.create_index(
        "ix_election_ballot_boxes_election_id", "election_ballot_boxes", ["election_id"]
    )
    op.create_index("ix_election_ballot_boxes_status", "election_ballot_boxes", ["status"])
    op.create_table(
        "vote_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("election_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ballot_box_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(300), nullable=False),
        sa.Column("operator_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reverses_event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["ballot_box_id"], ["election_ballot_boxes.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["candidate_id"], ["election_candidates.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["election_id"], ["elections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["operator_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reverses_event_id"], ["vote_events.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reverses_event_id"),
    )
    op.create_index("ix_vote_events_election_id", "vote_events", ["election_id"])
    op.create_index("ix_vote_events_ballot_box_id", "vote_events", ["ballot_box_id"])
    op.create_index("ix_vote_events_candidate_id", "vote_events", ["candidate_id"])
    op.create_index("ix_vote_events_operator_id", "vote_events", ["operator_id"])
    op.create_index("ix_vote_events_election_created", "vote_events", ["election_id", "created_at"])
    op.create_index(
        "ix_vote_events_box_candidate", "vote_events", ["ballot_box_id", "candidate_id"]
    )


def downgrade() -> None:
    op.drop_table("vote_events")
    op.drop_table("election_ballot_boxes")
    op.drop_table("election_candidates")
    op.drop_table("elections")
