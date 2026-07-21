"""儲存特約實體據點的 Google Maps 連結。

Revision ID: 202607220002
Revises: 202607220001
Create Date: 2026-07-22 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "202607220002"
down_revision: str | Sequence[str] | None = "202607220001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("partner_locations", sa.Column("google_maps_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("partner_locations", "google_maps_url")
