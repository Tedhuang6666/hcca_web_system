"""保留 revision 節點，避免 migration graph 斷裂

Revision ID: fad66dfdefa7
Revises: 20260529140000
Create Date: 2026-05-29 21:14:55.213526
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "fad66dfdefa7"
down_revision: str | Sequence[str] | None = "20260529140000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass