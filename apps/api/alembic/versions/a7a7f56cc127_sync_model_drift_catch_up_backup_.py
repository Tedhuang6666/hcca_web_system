"""保留 revision 節點，避免 catch-up migration 重複套用既有 schema

Revision ID: a7a7f56cc127
Revises: c1d2e3f4a5b6
"""

from collections.abc import Sequence

revision: str = "a7a7f56cc127"
down_revision: str | Sequence[str] | None = "c1d2e3f4a5b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
