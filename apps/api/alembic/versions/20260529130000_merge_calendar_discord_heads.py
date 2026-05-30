"""merge calendar and discord product heads

Revision ID: 20260529130000
Revises: 20260529110000, 20260529120000
Create Date: 2026-05-29 13:00:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "20260529130000"
down_revision: str | Sequence[str] | None = ("20260529110000", "20260529120000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
