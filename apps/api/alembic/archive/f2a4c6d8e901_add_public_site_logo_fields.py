"""add_public_site_logo_fields

Revision ID: f2a4c6d8e901
Revises: e4b7c8d9a001
Create Date: 2026-06-03 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2a4c6d8e901"
down_revision: str | Sequence[str] | None = "e4b7c8d9a001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("public_site_settings", sa.Column("site_logo_url", sa.Text(), nullable=True))
    op.add_column(
        "public_site_settings",
        sa.Column("site_logo_alt", sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("public_site_settings", "site_logo_alt")
    op.drop_column("public_site_settings", "site_logo_url")
