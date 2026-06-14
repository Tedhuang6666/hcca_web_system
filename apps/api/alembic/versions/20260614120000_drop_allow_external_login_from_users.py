"""drop allow_external_login from users

Revision ID: 20260614120000
Revises: fbc1a34fda7d
Create Date: 2026-06-14 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260614120000"
down_revision: str | Sequence[str] | None = "fbc1a34fda7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("users", "allow_external_login")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "allow_external_login",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("users", "allow_external_login", server_default=None)
