"""add survey question validation rules and respondent email

Revision ID: 20260517160000
Revises: 20260517100000
Create Date: 2026-05-17 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260517160000"
down_revision: str | Sequence[str] | None = "20260517100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("survey_questions", sa.Column("min_length", sa.Integer(), nullable=True))
    op.add_column("survey_questions", sa.Column("max_length", sa.Integer(), nullable=True))
    op.add_column(
        "survey_questions",
        sa.Column("validation_rule", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "survey_responses",
        sa.Column("respondent_email", sa.String(length=320), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("survey_responses", "respondent_email")
    op.drop_column("survey_questions", "validation_rule")
    op.drop_column("survey_questions", "max_length")
    op.drop_column("survey_questions", "min_length")
