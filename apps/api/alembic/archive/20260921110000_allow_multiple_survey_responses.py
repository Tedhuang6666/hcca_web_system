"""允許問卷多次填答

Revision ID: 20260921110000
Revises: 7a3fe68a9741
Create Date: 2026-09-21 11:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260921110000"
down_revision: str | Sequence[str] | None = "7a3fe68a9741"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """移除與 allow_multiple 設定衝突的回應唯一限制。"""
    op.drop_constraint("uq_survey_respondent", "survey_responses", type_="unique")


def downgrade() -> None:
    """還原每位使用者每份問卷僅一份回應的舊限制。"""
    op.create_unique_constraint(
        "uq_survey_respondent",
        "survey_responses",
        ["survey_id", "respondent_id"],
    )
