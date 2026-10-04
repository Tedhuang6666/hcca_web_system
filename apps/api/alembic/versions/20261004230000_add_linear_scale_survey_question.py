"""Add linear scale survey question type."""

from collections.abc import Sequence

from alembic import op

revision: str = "20261004230000"
down_revision: str | Sequence[str] | None = "20261004220000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE questiontype ADD VALUE IF NOT EXISTS 'linear_scale'")


def downgrade() -> None:
    # PostgreSQL 不支援安全移除單一 questiontype enum 值。
    pass
