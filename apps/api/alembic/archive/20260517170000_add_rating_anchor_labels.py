"""add rating anchor labels to survey_questions

Revision ID: 20260517170000
Revises: 20260517160000
Create Date: 2026-05-17 17:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260517170000"
down_revision: str | Sequence[str] | None = "20260517160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("survey_questions", sa.Column("min_label", sa.String(length=50), nullable=True))
    op.add_column("survey_questions", sa.Column("max_label", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("survey_questions", "max_label")
    op.drop_column("survey_questions", "min_label")
