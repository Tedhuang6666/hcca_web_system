"""add_ranking_question_type_and_option_config

Revision ID: d71723bb5ccb
Revises: 20260526093000
Create Date: 2026-05-27 09:44:22.739349

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d71723bb5ccb"
down_revision: str | Sequence[str] | None = "20260526093000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    - 新增 RANKING 題型到 questiontype enum
    - survey_questions.option_config_json：選項標記（互斥／其他）
    - survey_answers.other_text：多選題勾選「其他」時的補充文字
    """
    op.execute("ALTER TYPE questiontype ADD VALUE IF NOT EXISTS 'ranking'")
    op.add_column(
        "survey_questions",
        sa.Column("option_config_json", sa.Text(), nullable=True),
    )
    op.add_column(
        "survey_answers",
        sa.Column("other_text", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema.

    PostgreSQL 不支援從 enum 移除單一值，故 enum 變更不回滾。
    """
    op.drop_column("survey_answers", "other_text")
    op.drop_column("survey_questions", "option_config_json")
