"""新增校商投稿圖片完整 metadata 與偵測版本欄位。

Revision ID: 20260728160000
Revises: 20260728150000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260728160000"
down_revision: str | Sequence[str] | None = "20260728150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "merchandise_submission_files",
        sa.Column(
            "ai_detection_metadata",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="[]",
            nullable=False,
        ),
    )
    op.add_column(
        "merchandise_submission_files",
        sa.Column("ai_detection_version", sa.String(length=30), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("merchandise_submission_files", "ai_detection_version")
    op.drop_column("merchandise_submission_files", "ai_detection_metadata")
