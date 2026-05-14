"""add proposal metadata snapshot to regulation revision

Revision ID: a1b2c3d4e5f7
Revises: f9a0b1c2d3e4
Create Date: 2026-05-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f7"
down_revision: str | None = "f9a0b1c2d3e4"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "regulation_revisions",
        sa.Column("proposal_metadata_snapshot", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("regulation_revisions", "proposal_metadata_snapshot")
