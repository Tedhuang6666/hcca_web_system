"""add finance account type index

Revision ID: 8d27baee5bbf
Revises: 07c994ca2b8f
Create Date: 2026-07-18 14:35:55.045797

"""
from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "8d27baee5bbf"
down_revision: str | Sequence[str] | None = "07c994ca2b8f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        "ix_finance_chart_accounts_account_type",
        "finance_chart_accounts",
        ["account_type"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_finance_chart_accounts_account_type", table_name="finance_chart_accounts")
