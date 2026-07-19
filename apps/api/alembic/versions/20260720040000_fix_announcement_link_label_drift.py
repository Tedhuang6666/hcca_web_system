"""補上公告導向按鈕文字欄位。

Revision ID: 20260720040000
Revises: e70b436041f3
Create Date: 2026-07-20 04:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260720040000"
down_revision: str | Sequence[str] | None = "e70b436041f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """補齊可能因舊版 e70 migration 遺漏的欄位。"""
    op.execute("ALTER TABLE announcements ADD COLUMN IF NOT EXISTS link_label VARCHAR(60)")


def downgrade() -> None:
    """保留欄位，避免回退時破壞 e70 migration 的既有 schema 契約。"""
