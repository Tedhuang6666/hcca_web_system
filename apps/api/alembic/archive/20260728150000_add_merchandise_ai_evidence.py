"""新增校商投稿圖片 AI metadata 證據欄位。

Revision ID: 20260728150000
Revises: 20260728130000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260728150000"
down_revision: str | Sequence[str] | None = "20260728130000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "merchandise_submission_files",
        sa.Column("ai_detection_status", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "merchandise_submission_files",
        sa.Column(
            "ai_detection_evidence",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="[]",
            nullable=False,
        ),
    )
    op.add_column(
        "merchandise_submission_files",
        sa.Column("ai_detection_sha256", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "merchandise_submission_files",
        sa.Column("ai_detection_scanned_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("merchandise_submission_files", "ai_detection_scanned_at")
    op.drop_column("merchandise_submission_files", "ai_detection_sha256")
    op.drop_column("merchandise_submission_files", "ai_detection_evidence")
    op.drop_column("merchandise_submission_files", "ai_detection_status")
