"""remove phone fields

Revision ID: 1a2b3c4d5e6f
Revises: e4b8a1c9d2f0
Create Date: 2026-05-14

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "1a2b3c4d5e6f"
down_revision: str | Sequence[str] | None = "e4b8a1c9d2f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("documents", "handler_phone")
    op.drop_column("petition_cases", "contact_phone")
    op.drop_column("users", "show_phone")
    op.drop_column("users", "phone")


def downgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(length=30), nullable=True))
    op.add_column(
        "users",
        sa.Column("show_phone", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "petition_cases",
        sa.Column("contact_phone", sa.String(length=30), nullable=True),
    )
    op.add_column("documents", sa.Column("handler_phone", sa.String(length=30), nullable=True))
