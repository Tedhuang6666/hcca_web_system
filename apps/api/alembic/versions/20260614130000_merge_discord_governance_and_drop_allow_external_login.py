"""合併 Discord 治理政策與移除 allow_external_login 兩條分支。

Revision ID: 20260614130000
Revises: 20260612030000, 20260614120000
Create Date: 2026-06-14 13:00:00.000000
"""

from collections.abc import Sequence

revision: str = "20260614130000"
down_revision: tuple[str, str] = ("20260612030000", "20260614120000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
