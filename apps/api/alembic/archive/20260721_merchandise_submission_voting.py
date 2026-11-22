"""新增校商投稿審核完成狀態與全校投票問卷關聯。

Revision ID: 20260721merchvoting
Revises: 20260720_product_analytics
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260721merchvoting"
down_revision: str | Sequence[str] | None = "20260720_product_analytics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("survey_questions", sa.Column("option_image_sets_json", sa.Text(), nullable=True))
    op.execute("ALTER TYPE merchandisesubmissionstatus ADD VALUE IF NOT EXISTS 'REVIEW_COMPLETED'")
    op.add_column(
        "merchandise_submissions",
        sa.Column("voting_survey_id", sa.UUID(), nullable=True),
    )
    op.create_index(
        "ix_merchandise_submissions_voting_survey_id",
        "merchandise_submissions",
        ["voting_survey_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_merchandise_submissions_voting_survey_id_surveys",
        "merchandise_submissions",
        "surveys",
        ["voting_survey_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_column("survey_questions", "option_image_sets_json")
    op.drop_constraint(
        "fk_merchandise_submissions_voting_survey_id_surveys",
        "merchandise_submissions",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_merchandise_submissions_voting_survey_id",
        table_name="merchandise_submissions",
    )
    op.drop_column("merchandise_submissions", "voting_survey_id")
    # PostgreSQL 不支援安全地從 native enum 移除單一值；保留該值不影響舊版應用程式。
