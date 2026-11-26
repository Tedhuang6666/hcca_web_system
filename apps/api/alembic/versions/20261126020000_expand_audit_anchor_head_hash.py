"""Expand audit anchor hash for versioned HMAC values.

Revision ID: 20261126020000
Revises: 20261126010000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261126020000"
down_revision: str | None = "20261126010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "audit_log_anchors",
        "head_hash",
        existing_type=sa.String(length=64),
        type_=sa.String(length=128),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "audit_log_anchors",
        "head_hash",
        existing_type=sa.String(length=128),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
