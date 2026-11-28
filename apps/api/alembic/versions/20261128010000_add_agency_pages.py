"""Add agency profile pages and public entries.

Revision ID: 20261128010000
Revises: 20261126030000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261128010000"
down_revision: str | None = "20261126030000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "agency_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(length=40), nullable=False),
        sa.Column("branch", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("tagline", sa.String(length=200), nullable=True),
        sa.Column(
            "org_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("intro_md", sa.Text(), server_default="", nullable=False),
        sa.Column("mandate_md", sa.Text(), nullable=True),
        sa.Column("contact_md", sa.Text(), nullable=True),
        sa.Column("is_published", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("slug", name="uq_agency_profiles_slug"),
    )
    op.create_index("ix_agency_profiles_branch", "agency_profiles", ["branch"])
    op.create_index("ix_agency_profiles_org_id", "agency_profiles", ["org_id"])
    op.create_index(
        "ix_agency_profiles_published_sort", "agency_profiles", ["is_published", "sort_order"]
    )

    op.create_table(
        "agency_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "agency_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agency_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("reference_no", sa.String(length=60), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("body_md", sa.Text(), nullable=True),
        sa.Column("outcome_md", sa.Text(), nullable=True),
        sa.Column("occurred_on", sa.Date(), nullable=True),
        sa.Column("link_url", sa.String(length=500), nullable=True),
        sa.Column("show_on_calendar", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_published", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_agency_entries_agency_id", "agency_entries", ["agency_id"])
    op.create_index(
        "ix_agency_entries_agency_kind_published",
        "agency_entries",
        ["agency_id", "kind", "is_published"],
    )
    op.create_index(
        "ix_agency_entries_calendar", "agency_entries", ["show_on_calendar", "occurred_on"]
    )


def downgrade() -> None:
    op.drop_table("agency_entries")
    op.drop_table("agency_profiles")
