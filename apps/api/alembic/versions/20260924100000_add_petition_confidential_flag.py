"""新增陳情密件處理旗標

Revision ID: 20260924100000
Revises: 20260922120000
Create Date: 2026-09-24 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260924100000"
down_revision: str | Sequence[str] | None = "20260922120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "petition_cases",
        sa.Column(
            "is_confidential",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_petition_cases_is_confidential",
        "petition_cases",
        ["is_confidential"],
    )


def downgrade() -> None:
    op.drop_index("ix_petition_cases_is_confidential", table_name="petition_cases")
    op.drop_column("petition_cases", "is_confidential")
