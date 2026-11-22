"""secure petition share token

Revision ID: 07c994ca2b8f
Revises: 10d60344052b
Create Date: 2026-07-18 14:35:25.702335

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "07c994ca2b8f"
down_revision: str | Sequence[str] | None = "10d60344052b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing cases intentionally receive no valid share token.  Their legacy 5-digit
    # links are retired rather than silently retaining a weak credential.
    op.add_column(
        "petition_cases",
        sa.Column("share_token_hash", sa.String(length=64), nullable=False, server_default=""),
    )
    op.alter_column("petition_cases", "share_token_hash", server_default=None)
    op.create_index("ix_petition_cases_share_token_hash", "petition_cases", ["share_token_hash"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_petition_cases_share_token_hash", table_name="petition_cases")
    op.drop_column("petition_cases", "share_token_hash")
