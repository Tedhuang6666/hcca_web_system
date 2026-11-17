"""新增報帳品項稅率

Revision ID: 10d60344052b
Revises: 3b91407c691b
Create Date: 2026-07-18 13:32:32.489081

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "10d60344052b"
down_revision: str | Sequence[str] | None = "3b91407c691b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "finance_expense_claim_items",
        sa.Column("tax_rate", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("finance_expense_claim_items", "tax_rate")
