"""add lineage_id to regulation_articles

沿革識別碼：同一條文跨版本（修正案 fork）保持穩定，
使重新排序不會被誤判為刪除＋重新建立。
既有資料每列各自填入新的 uuid（無法回溯歷史血緣，僅新案起生效）。

Revision ID: 20260519100000
Revises: 20260518130000
Create Date: 2026-05-19 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260519100000"
down_revision: str | Sequence[str] | None = "20260518130000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "regulation_articles",
        sa.Column(
            "lineage_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
    )
    # server_default 僅供既有資料回填；模型端以 Python default 產生，故移除 DB 端預設
    op.alter_column("regulation_articles", "lineage_id", server_default=None)


def downgrade() -> None:
    op.drop_column("regulation_articles", "lineage_id")
