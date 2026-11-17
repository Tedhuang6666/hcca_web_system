"""add org bill_stage for meeting agenda auto-detection

Revision ID: 20260522110000
Revises: 20260522100000
Create Date: 2026-05-22 11:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260522110000"
down_revision: str | Sequence[str] | None = "20260522100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orgs", sa.Column("bill_stage", sa.String(length=30), nullable=True))


def downgrade() -> None:
    op.drop_column("orgs", "bill_stage")
