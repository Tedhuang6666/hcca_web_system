"""新增推薦商家與菜單商品資訊

Revision ID: 2a8f1d7c9b10
Revises: ffff8afe1b1d
Create Date: 2026-07-21

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2a8f1d7c9b10"
down_revision: str | Sequence[str] | None = "ffff8afe1b1d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recommended_vendors",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.String(length=300), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=80), nullable=True),
        sa.Column("address", sa.String(length=300), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("google_maps_url", sa.Text(), nullable=True),
        sa.Column("business_hours_text", sa.String(length=300), nullable=True),
        sa.Column("contact_name", sa.String(length=100), nullable=True),
        sa.Column("contact_phone", sa.String(length=50), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("line_id", sa.String(length=100), nullable=True),
        sa.Column("social_url", sa.Text(), nullable=True),
        sa.Column("website_url", sa.Text(), nullable=True),
        sa.Column("ordering_instructions", sa.Text(), nullable=True),
        sa.Column("menu_url", sa.Text(), nullable=True),
        sa.Column("hygiene_inspection_date", sa.Date(), nullable=True),
        sa.Column("hygiene_inspection_expires_at", sa.Date(), nullable=True),
        sa.Column("hygiene_certificate_url", sa.Text(), nullable=True),
        sa.Column("hygiene_note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="draft", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("internal_note", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recommended_vendors_name", "recommended_vendors", ["name"])
    op.create_index("ix_recommended_vendors_category", "recommended_vendors", ["category"])
    op.create_index("ix_recommended_vendors_latitude", "recommended_vendors", ["latitude"])
    op.create_index("ix_recommended_vendors_longitude", "recommended_vendors", ["longitude"])
    op.create_index("ix_recommended_vendors_status", "recommended_vendors", ["status"])
    op.create_index("ix_recommended_vendors_is_active", "recommended_vendors", ["is_active"])

    op.create_table(
        "recommended_vendor_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_text", sa.String(length=80), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("menu_url", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["vendor_id"], ["recommended_vendors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recommended_vendor_products_vendor_id", "recommended_vendor_products", ["vendor_id"])
    op.create_index("ix_recommended_vendor_products_is_active", "recommended_vendor_products", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_recommended_vendor_products_is_active", table_name="recommended_vendor_products")
    op.drop_index("ix_recommended_vendor_products_vendor_id", table_name="recommended_vendor_products")
    op.drop_table("recommended_vendor_products")
    for index in (
        "ix_recommended_vendors_is_active",
        "ix_recommended_vendors_status",
        "ix_recommended_vendors_longitude",
        "ix_recommended_vendors_latitude",
        "ix_recommended_vendors_category",
        "ix_recommended_vendors_name",
    ):
        op.drop_index(index, table_name="recommended_vendors")
    op.drop_table("recommended_vendors")
