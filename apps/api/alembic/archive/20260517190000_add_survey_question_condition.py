"""add display condition to survey_questions

Revision ID: 20260517190000
Revises: 20260517180000
Create Date: 2026-05-17 19:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260517190000"
down_revision: str | Sequence[str] | None = "20260517180000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("survey_questions", sa.Column("condition_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("survey_questions", "condition_json")
