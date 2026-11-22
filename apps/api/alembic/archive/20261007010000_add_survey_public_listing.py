"""Add public listing visibility to surveys.

Revision ID: 20261007010000
Revises: 20261005010000
Create Date: 2026-10-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261007010000"
down_revision = "20261005010000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "surveys",
        sa.Column("is_listed", sa.Boolean(), server_default="true", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("surveys", "is_listed")
