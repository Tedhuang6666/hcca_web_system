"""add council proposals and judicial petitions

Revision ID: 20260603counciljudicial
Revises: 8c3b0c6d9f21
Create Date: 2026-06-03 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260603counciljudicial"
down_revision = "8c3b0c6d9f21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "council_proposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("serial_number", sa.String(length=20), nullable=False),
        sa.Column("submitter_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("contact_name", sa.String(length=100), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=False),
        sa.Column("proposer_name", sa.String(length=100), nullable=False),
        sa.Column("co_sponsors", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("legal_basis", sa.Text(), nullable=True),
        sa.Column("proposal_text", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("expected_effect", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), server_default="submitted", nullable=False),
        sa.Column("committee_review_note", sa.Text(), nullable=True),
        sa.Column("scheduled_meeting_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["scheduled_meeting_id"], ["meetings.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["submitter_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("serial_number"),
    )
    op.create_index("ix_council_proposals_kind", "council_proposals", ["kind"])
    op.create_index("ix_council_proposals_serial_number", "council_proposals", ["serial_number"])
    op.create_index("ix_council_proposals_status", "council_proposals", ["status"])
    op.create_index(
        "ix_council_proposals_status_created", "council_proposals", ["status", "created_at"]
    )
    op.create_index("ix_council_proposals_submitter_id", "council_proposals", ["submitter_id"])
    op.create_index(
        "ix_council_proposals_submitter_status",
        "council_proposals",
        ["submitter_id", "status"],
    )
    op.create_index("ix_council_proposals_title", "council_proposals", ["title"])

    op.create_table(
        "judicial_petitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("docket_number", sa.String(length=20), nullable=False),
        sa.Column("submitter_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("petitioner_name", sa.String(length=100), nullable=False),
        sa.Column("petitioner_email", sa.String(length=255), nullable=False),
        sa.Column("representative", sa.String(length=100), nullable=True),
        sa.Column("respondent", sa.String(length=200), nullable=True),
        sa.Column("petition_type", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("challenged_norm", sa.Text(), nullable=False),
        sa.Column("constitutional_provisions", sa.Text(), nullable=False),
        sa.Column("petition_claim", sa.Text(), nullable=False),
        sa.Column("facts_and_reasons", sa.Text(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("attachments_description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), server_default="submitted", nullable=False),
        sa.Column("docketing_note", sa.Text(), nullable=True),
        sa.Column("decision_summary", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["submitter_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("docket_number"),
    )
    op.create_index("ix_judicial_petitions_docket_number", "judicial_petitions", ["docket_number"])
    op.create_index("ix_judicial_petitions_petition_type", "judicial_petitions", ["petition_type"])
    op.create_index("ix_judicial_petitions_status", "judicial_petitions", ["status"])
    op.create_index(
        "ix_judicial_petitions_status_created", "judicial_petitions", ["status", "created_at"]
    )
    op.create_index("ix_judicial_petitions_submitter_id", "judicial_petitions", ["submitter_id"])
    op.create_index(
        "ix_judicial_petitions_submitter_status",
        "judicial_petitions",
        ["submitter_id", "status"],
    )
    op.create_index("ix_judicial_petitions_title", "judicial_petitions", ["title"])


def downgrade() -> None:
    op.drop_index("ix_judicial_petitions_title", table_name="judicial_petitions")
    op.drop_index("ix_judicial_petitions_submitter_status", table_name="judicial_petitions")
    op.drop_index("ix_judicial_petitions_submitter_id", table_name="judicial_petitions")
    op.drop_index("ix_judicial_petitions_status_created", table_name="judicial_petitions")
    op.drop_index("ix_judicial_petitions_status", table_name="judicial_petitions")
    op.drop_index("ix_judicial_petitions_petition_type", table_name="judicial_petitions")
    op.drop_index("ix_judicial_petitions_docket_number", table_name="judicial_petitions")
    op.drop_table("judicial_petitions")

    op.drop_index("ix_council_proposals_title", table_name="council_proposals")
    op.drop_index("ix_council_proposals_submitter_status", table_name="council_proposals")
    op.drop_index("ix_council_proposals_submitter_id", table_name="council_proposals")
    op.drop_index("ix_council_proposals_status_created", table_name="council_proposals")
    op.drop_index("ix_council_proposals_status", table_name="council_proposals")
    op.drop_index("ix_council_proposals_serial_number", table_name="council_proposals")
    op.drop_index("ix_council_proposals_kind", table_name="council_proposals")
    op.drop_table("council_proposals")
