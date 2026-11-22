"""add org is_active

Revision ID: 0f1e2d3c4b5a
Revises: 1a2b3c4d5e6f
Create Date: 2026-05-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0f1e2d3c4b5a"
down_revision: str | Sequence[str] | None = "1a2b3c4d5e6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orgs",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_orgs_is_active", "orgs", ["is_active"], unique=False)
    op.alter_column("orgs", "is_active", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_orgs_is_active", table_name="orgs")
    op.drop_column("orgs", "is_active")
