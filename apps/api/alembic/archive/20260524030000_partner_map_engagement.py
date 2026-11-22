"""partner map engagement

Revision ID: 20260524030000
Revises: 20260524020000
Create Date: 2026-05-24 03:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260524030000"
down_revision: str | Sequence[str] | None = "20260524020000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("partner_businesses", sa.Column("cover_image_url", sa.Text(), nullable=True))
    op.add_column("partner_businesses", sa.Column("category", sa.String(length=50), nullable=True))
    op.add_column(
        "partner_businesses", sa.Column("business_hours_text", sa.String(length=300), nullable=True)
    )
    op.add_column(
        "partner_businesses",
        sa.Column("view_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "partner_businesses",
        sa.Column("click_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "partner_businesses",
        sa.Column("checkin_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index("ix_partner_businesses_category", "partner_businesses", ["category"])

    op.create_table(
        "partner_ratings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("visit_count", sa.Integer(), server_default="1", nullable=False),
        sa.Column("is_public", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("business_id", "user_id", name="uq_partner_rating_user"),
    )
    op.create_index("ix_partner_ratings_business_id", "partner_ratings", ["business_id"])
    op.create_index("ix_partner_ratings_user_id", "partner_ratings", ["user_id"])
    op.create_index("ix_partner_ratings_is_public", "partner_ratings", ["is_public"])

    op.create_table(
        "partner_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=True),
        sa.Column("address", sa.String(length=300), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("offer_hint", sa.String(length=300), nullable=True),
        sa.Column("contact_hint", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_partner_submissions_name", "partner_submissions", ["name"])
    op.create_index("ix_partner_submissions_status", "partner_submissions", ["status"])
    op.create_index("ix_partner_submissions_submitted_by", "partner_submissions", ["submitted_by"])


def downgrade() -> None:
    op.drop_index("ix_partner_submissions_submitted_by", table_name="partner_submissions")
    op.drop_index("ix_partner_submissions_status", table_name="partner_submissions")
    op.drop_index("ix_partner_submissions_name", table_name="partner_submissions")
    op.drop_table("partner_submissions")

    op.drop_index("ix_partner_ratings_is_public", table_name="partner_ratings")
    op.drop_index("ix_partner_ratings_user_id", table_name="partner_ratings")
    op.drop_index("ix_partner_ratings_business_id", table_name="partner_ratings")
    op.drop_table("partner_ratings")

    op.drop_index("ix_partner_businesses_category", table_name="partner_businesses")
    op.drop_column("partner_businesses", "checkin_count")
    op.drop_column("partner_businesses", "click_count")
    op.drop_column("partner_businesses", "view_count")
    op.drop_column("partner_businesses", "business_hours_text")
    op.drop_column("partner_businesses", "category")
    op.drop_column("partner_businesses", "cover_image_url")
