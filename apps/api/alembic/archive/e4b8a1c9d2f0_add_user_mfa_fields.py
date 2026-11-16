"""add_user_mfa_fields

Revision ID: e4b8a1c9d2f0
Revises: de3a735c3e6b
Create Date: 2026-05-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4b8a1c9d2f0"
down_revision: str | Sequence[str] | None = "de3a735c3e6b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "mfa_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column("users", sa.Column("mfa_secret", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("mfa_pending_secret", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "mfa_pending_secret")
    op.drop_column("users", "mfa_secret")
    op.drop_column("users", "mfa_enabled")
