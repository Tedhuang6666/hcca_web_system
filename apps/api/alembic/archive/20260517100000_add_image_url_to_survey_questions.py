"""add image_url to survey_questions

Revision ID: 20260517100000
Revises: 20260515153000
Create Date: 2026-05-17 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260517100000"
down_revision: str | Sequence[str] | None = "20260515153000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "survey_questions",
        sa.Column("image_url", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("survey_questions", "image_url")
