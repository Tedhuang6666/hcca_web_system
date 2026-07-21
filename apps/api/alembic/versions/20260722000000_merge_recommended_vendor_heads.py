"""合併推薦商家分類與既有 migration head。

Revision ID: 20260722000000
Revises: 18b7eaf4d68e, 2b7e4c8d1f20
Create Date: 2026-07-22 00:00:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "20260722000000"
down_revision: str | Sequence[str] | None = ("18b7eaf4d68e", "2b7e4c8d1f20")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
