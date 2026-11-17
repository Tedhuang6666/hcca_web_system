"""新增預算草案議員審理公開設定

Revision ID: 20260904110000
Revises: 20260903090000
Create Date: 2026-09-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260904110000"
down_revision: str | Sequence[str] | None = "20260903090000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "finance_budget_submissions",
        sa.Column(
            "is_council_review_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("finance_budget_submissions", "is_council_review_public")
