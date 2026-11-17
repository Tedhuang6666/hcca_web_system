"""add position category

Revision ID: 20260526093000
Revises: 20260526discord
Create Date: 2026-05-26 09:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260526093000"
down_revision: str | Sequence[str] | None = "20260526discord"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "positions",
        sa.Column("category", sa.String(length=20), server_default="council", nullable=False),
    )
    op.create_index("ix_positions_category", "positions", ["category"])
    op.execute(
        """
        UPDATE positions
        SET category = 'class'
        WHERE id IN (SELECT position_id FROM class_role_bindings)
        """
    )
    op.execute(
        """
        UPDATE positions
        SET category = 'system'
        WHERE name LIKE '外部協作-%'
        """
    )


def downgrade() -> None:
    op.drop_index("ix_positions_category", table_name="positions")
    op.drop_column("positions", "category")
