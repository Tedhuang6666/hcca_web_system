"""add allow_external_login to users

Revision ID: 20260515153000
Revises: 20260515140000
Create Date: 2026-05-15 15:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260515153000"
down_revision: str | Sequence[str] | None = "20260515140000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "allow_external_login",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # 保留既有校外信箱超管的登入能力，但之後與超管權限完全分離管理。
    op.execute(
        """
        UPDATE users
        SET allow_external_login = true
        WHERE is_superuser = true
          AND split_part(lower(email), '@', 2) <> 'hchs.hc.edu.tw'
        """
    )
    op.alter_column("users", "allow_external_login", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "allow_external_login")
