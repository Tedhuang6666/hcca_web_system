"""合併特約標籤圖示與文件收件對象 migration heads。

Revision ID: 20260722040000
Revises: 20260722030000, 0a7c8d9e1f20
"""

from collections.abc import Sequence

revision: str = "20260722040000"
down_revision: str | Sequence[str] | None = ("20260722030000", "0a7c8d9e1f20")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
