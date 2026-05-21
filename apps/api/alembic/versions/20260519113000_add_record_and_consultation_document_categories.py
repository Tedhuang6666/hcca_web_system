"""add record and consultation document categories

Revision ID: 20260519113000
Revises: 20260519100000
Create Date: 2026-05-19 11:30:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260519113000"
down_revision: str | Sequence[str] | None = "20260519100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE documentcategory ADD VALUE IF NOT EXISTS 'record'")
    op.execute("ALTER TYPE documentcategory ADD VALUE IF NOT EXISTS 'consultation'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be dropped safely without rebuilding the type.
    pass
