"""add line account links

Revision ID: 20260524040000
Revises: 20260524_floor, 20260524030000
Create Date: 2026-05-24 04:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260524040000"
down_revision: str | Sequence[str] | None = ("20260524_floor", "20260524030000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "line_account_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("line_user_id", sa.String(length=128), nullable=False),
        sa.Column("line_display_name", sa.String(length=200), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("line_user_id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(
        "ix_line_account_links_is_active", "line_account_links", ["is_active"], unique=False
    )
    op.create_index(
        "ix_line_account_links_line_user_id", "line_account_links", ["line_user_id"], unique=True
    )
    op.create_index("ix_line_account_links_user_id", "line_account_links", ["user_id"], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_line_account_links_user_id", table_name="line_account_links")
    op.drop_index("ix_line_account_links_line_user_id", table_name="line_account_links")
    op.drop_index("ix_line_account_links_is_active", table_name="line_account_links")
    op.drop_table("line_account_links")
