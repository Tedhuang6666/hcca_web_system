"""add partner map

Revision ID: 20260524010000
Revises: defc1e68a276
Create Date: 2026-05-24 01:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260524010000"
down_revision: str | Sequence[str] | None = "defc1e68a276"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")

    op.create_table(
        "partner_tags",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_partner_tags_name"),
    )
    op.create_index("ix_partner_tags_is_active", "partner_tags", ["is_active"])

    op.create_table(
        "partner_businesses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.String(length=300), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("website_url", sa.Text(), nullable=True),
        sa.Column("social_url", sa.Text(), nullable=True),
        sa.Column("logo_url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("internal_note", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_partner_businesses_name", "partner_businesses", ["name"])
    op.create_index("ix_partner_businesses_status", "partner_businesses", ["status"])

    op.create_table(
        "partner_business_tags",
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tag_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["partner_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("business_id", "tag_id"),
    )

    op.create_table(
        "partner_locations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("address", sa.String(length=300), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("business_hours", json_type, nullable=False),
        sa.Column("google_place_id", sa.String(length=255), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_partner_locations_business_id", "partner_locations", ["business_id"])
    op.create_index("ix_partner_locations_is_active", "partner_locations", ["is_active"])
    op.create_index("ix_partner_locations_latitude", "partner_locations", ["latitude"])
    op.create_index("ix_partner_locations_longitude", "partner_locations", ["longitude"])

    op.create_table(
        "partner_offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("public_summary", sa.String(length=300), nullable=True),
        sa.Column("full_description", sa.Text(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column("member_note", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_partner_offers_business_id", "partner_offers", ["business_id"])
    op.create_index("ix_partner_offers_is_active", "partner_offers", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_partner_offers_is_active", table_name="partner_offers")
    op.drop_index("ix_partner_offers_business_id", table_name="partner_offers")
    op.drop_table("partner_offers")

    op.drop_index("ix_partner_locations_longitude", table_name="partner_locations")
    op.drop_index("ix_partner_locations_latitude", table_name="partner_locations")
    op.drop_index("ix_partner_locations_is_active", table_name="partner_locations")
    op.drop_index("ix_partner_locations_business_id", table_name="partner_locations")
    op.drop_table("partner_locations")

    op.drop_table("partner_business_tags")

    op.drop_index("ix_partner_businesses_status", table_name="partner_businesses")
    op.drop_index("ix_partner_businesses_name", table_name="partner_businesses")
    op.drop_table("partner_businesses")

    op.drop_index("ix_partner_tags_is_active", table_name="partner_tags")
    op.drop_table("partner_tags")
