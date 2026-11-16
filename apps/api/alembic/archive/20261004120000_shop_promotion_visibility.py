"""Add public visibility to shop promotions.

Revision ID: 20261004120000
Revises: 20261003180000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261004120000"
down_revision: str | Sequence[str] | None = "20261003180000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shop_promotions",
        sa.Column("is_public", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.alter_column("shop_promotions", "is_public", server_default=None)


def downgrade() -> None:
    op.drop_column("shop_promotions", "is_public")
