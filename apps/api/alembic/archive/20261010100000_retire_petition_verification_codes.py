"""Retire petition verification codes for account based case access.

Revision ID: 20261010100000
Revises: 20261009230000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261010100000"
down_revision = "20261009230000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Keep legacy hashes for history, while allowing new cases to omit the retired code.
    op.alter_column(
        "petition_cases",
        "verification_code_hash",
        existing_type=sa.String(length=128),
        nullable=True,
    )


def downgrade() -> None:
    # New rows have no verification code. Empty sentinels restore the old schema shape,
    # but those rows intentionally cannot be accessed through the retired code flow.
    op.execute(
        "UPDATE petition_cases SET verification_code_hash = '' WHERE verification_code_hash IS NULL"
    )
    op.alter_column(
        "petition_cases",
        "verification_code_hash",
        existing_type=sa.String(length=128),
        nullable=False,
    )
