"""合併法規修正與可觀測性 migration heads。"""

from collections.abc import Sequence


revision: str = "20260816130000"
down_revision: str | Sequence[str] | None = (
    "20260816_regulation_sort",
    "20260816120000",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
