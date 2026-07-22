"""合併推薦商家功能的最新 migration heads。

Revision ID: 20260722020000
Revises: 202607220003, 20260722010000
Create Date: 2026-07-22 02:00:00.000000
"""

from collections.abc import Sequence


# revision identifiers, used by Alembic.
revision: str = "20260722020000"
down_revision: str | Sequence[str] | None = ("202607220003", "20260722010000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
