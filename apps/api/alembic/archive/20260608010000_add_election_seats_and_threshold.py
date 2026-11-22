"""選舉新增應選名額、得票率門檻與在校總人數。

Revision ID: 20260608010000
Revises: 20260607030000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260608010000"
down_revision: str | Sequence[str] | None = "20260607030000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "elections",
        sa.Column("seats", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column("elections", sa.Column("eligible_voter_count", sa.Integer(), nullable=True))
    op.add_column("elections", sa.Column("turnout_threshold_pct", sa.Float(), nullable=True))
    op.add_column("elections", sa.Column("vote_threshold_pct", sa.Float(), nullable=True))
    # 移除 server_default，讓往後新資料由應用層帶入
    op.alter_column("elections", "seats", server_default=None)


def downgrade() -> None:
    op.drop_column("elections", "vote_threshold_pct")
    op.drop_column("elections", "turnout_threshold_pct")
    op.drop_column("elections", "eligible_voter_count")
    op.drop_column("elections", "seats")
