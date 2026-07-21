"""重整特約優惠探索資料。

Revision ID: 202607220001
Revises: 20260722000000
Create Date: 2026-07-22 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "202607220001"
down_revision: str | Sequence[str] | None = "20260722000000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE partner_businesses SET listing_type = 'physical' WHERE listing_type = 'location'"
    )
    op.execute("UPDATE partner_businesses SET listing_type = 'online' WHERE listing_type = 'contact'")
    op.alter_column(
        "partner_businesses",
        "listing_type",
        existing_type=sa.String(length=20),
        server_default="physical",
    )
    op.add_column(
        "partner_offers",
        sa.Column("benefit_type", sa.String(length=30), nullable=False, server_default="other"),
    )
    op.add_column("partner_offers", sa.Column("benefit_value", sa.String(length=120), nullable=True))
    op.alter_column("partner_offers", "benefit_type", server_default=None)


def downgrade() -> None:
    op.drop_column("partner_offers", "benefit_value")
    op.drop_column("partner_offers", "benefit_type")
    op.execute(
        "UPDATE partner_businesses SET listing_type = 'location' WHERE listing_type = 'physical'"
    )
    op.execute("UPDATE partner_businesses SET listing_type = 'contact' WHERE listing_type = 'online'")
    op.alter_column(
        "partner_businesses",
        "listing_type",
        existing_type=sa.String(length=20),
        server_default="location",
    )
