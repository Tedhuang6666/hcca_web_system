"""merge multiple heads

Revision ID: cb8827c824f2
Revises: a9c1d2e3f4g5, e6f7a8b9c0d1
Create Date: 2026-05-03 17:53:03.701686

"""
from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = 'cb8827c824f2'
down_revision: str | Sequence[str] | None = ('a9c1d2e3f4g5', 'e6f7a8b9c0d1')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
