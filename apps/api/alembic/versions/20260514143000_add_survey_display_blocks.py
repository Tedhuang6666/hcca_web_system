"""add survey display block question types

Revision ID: 20260514143000
Revises: 7b8c9d0e1f23
Create Date: 2026-05-14 14:30:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260514143000"
down_revision: str | None = "7b8c9d0e1f23"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    for value in ("section_text", "page_break", "image", "video"):
        op.execute(f"ALTER TYPE questiontype ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely without rebuilding the type.
    pass
