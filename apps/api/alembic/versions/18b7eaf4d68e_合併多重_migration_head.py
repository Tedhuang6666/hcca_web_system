"""合併多重 migration head

Revision ID: 18b7eaf4d68e
Revises: 202607210003, 202607210004, 20260721merchvoting, 2a8f1d7c9b10
Create Date: 2026-07-21 23:21:49.839870

"""

# revision identifiers, used by Alembic.
revision: str = "18b7eaf4d68e"
down_revision: str | tuple[str, ...] | None = (
    "202607210003",
    "202607210004",
    "20260721merchvoting",
    "2a8f1d7c9b10",
)
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
