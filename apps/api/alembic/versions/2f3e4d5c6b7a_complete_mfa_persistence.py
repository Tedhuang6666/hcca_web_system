"""complete mfa persistence

Revision ID: 2f3e4d5c6b7a
Revises: 0f1e2d3c4b5a
Create Date: 2026-05-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2f3e4d5c6b7a"
down_revision: str | Sequence[str] | None = "0f1e2d3c4b5a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("users", "mfa_secret", type_=sa.Text(), existing_nullable=True)
    op.alter_column("users", "mfa_pending_secret", type_=sa.Text(), existing_nullable=True)
    op.add_column(
        "users",
        sa.Column(
            "mfa_backup_code_hashes",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="{}",
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "mfa_pending_backup_code_hashes",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="{}",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "mfa_pending_backup_code_hashes")
    op.drop_column("users", "mfa_backup_code_hashes")
    op.alter_column("users", "mfa_pending_secret", type_=sa.String(length=64), existing_nullable=True)
    op.alter_column("users", "mfa_secret", type_=sa.String(length=64), existing_nullable=True)
