"""新增僅提供聯絡方式的特約合作夥伴刊登方式。

Revision ID: 202607210004
Revises: 202607210002
Create Date: 2026-07-21 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607210004"
down_revision: str | Sequence[str] | None = "202607210002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "partner_businesses",
        sa.Column(
            "listing_type",
            sa.String(length=20),
            nullable=False,
            server_default="location",
        ),
    )
    op.add_column(
        "partner_businesses", sa.Column("contact_name", sa.String(length=100), nullable=True)
    )
    op.add_column(
        "partner_businesses", sa.Column("contact_phone", sa.String(length=50), nullable=True)
    )
    op.add_column(
        "partner_businesses", sa.Column("contact_email", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "partner_businesses",
        sa.Column("instagram_handle", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "partner_businesses", sa.Column("line_id", sa.String(length=100), nullable=True)
    )
    op.add_column(
        "partner_businesses", sa.Column("other_contact", sa.Text(), nullable=True)
    )
    op.create_index(
        "ix_partner_businesses_listing_type", "partner_businesses", ["listing_type"]
    )


def downgrade() -> None:
    op.drop_index("ix_partner_businesses_listing_type", table_name="partner_businesses")
    op.drop_column("partner_businesses", "other_contact")
    op.drop_column("partner_businesses", "line_id")
    op.drop_column("partner_businesses", "instagram_handle")
    op.drop_column("partner_businesses", "contact_email")
    op.drop_column("partner_businesses", "contact_phone")
    op.drop_column("partner_businesses", "contact_name")
    op.drop_column("partner_businesses", "listing_type")
