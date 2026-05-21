"""add audience access control to surveys

Revision ID: 20260518100000
Revises: 20260517190000
Create Date: 2026-05-18 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260518100000"
down_revision: str | Sequence[str] | None = "20260517190000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "surveys",
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("surveys", sa.Column("allowed_org_ids_json", sa.Text(), nullable=True))
    op.add_column("surveys", sa.Column("allowed_emails_json", sa.Text(), nullable=True))
    op.add_column("surveys", sa.Column("allowed_domains_json", sa.Text(), nullable=True))
    op.alter_column("surveys", "is_public", server_default=None)


def downgrade() -> None:
    op.drop_column("surveys", "allowed_domains_json")
    op.drop_column("surveys", "allowed_emails_json")
    op.drop_column("surveys", "allowed_org_ids_json")
    op.drop_column("surveys", "is_public")
