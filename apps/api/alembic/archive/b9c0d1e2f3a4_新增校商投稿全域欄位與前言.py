"""新增校商投稿全域欄位與前言

Revision ID: b9c0d1e2f3a4
Revises: 20260720050000
Create Date: 2026-07-20 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b9c0d1e2f3a4"
down_revision: str | Sequence[str] | None = "20260720050000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "merchandise_submission_settings",
        sa.Column("submission_intro", sa.Text(), nullable=True),
    )
    op.add_column(
        "merchandise_submission_settings",
        sa.Column(
            "global_fields",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="[]",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("merchandise_submission_settings", "global_fields")
    op.drop_column("merchandise_submission_settings", "submission_intro")
