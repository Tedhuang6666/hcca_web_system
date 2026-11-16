"""Add survey grid and four-field text question support."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261004220000"
down_revision: str | Sequence[str] | None = "20261004210000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE questiontype ADD VALUE IF NOT EXISTS 'single_grid'")
    op.execute("ALTER TYPE questiontype ADD VALUE IF NOT EXISTS 'multi_text'")
    op.add_column("survey_questions", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("survey_questions", sa.Column("grid_columns_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("survey_questions", "grid_columns_json")
    op.drop_column("survey_questions", "description")
    # PostgreSQL 不支援安全移除單一 questiontype enum 值。
