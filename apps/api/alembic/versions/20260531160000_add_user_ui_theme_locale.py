"""add user ui_theme and ui_locale columns

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-05-31 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: str | Sequence[str] | None = "b0c1d2e3f4a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "ui_theme",
            sa.String(length=10),
            nullable=False,
            server_default="auto",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "ui_locale",
            sa.String(length=10),
            nullable=False,
            server_default="zh-TW",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "ui_locale")
    op.drop_column("users", "ui_theme")
