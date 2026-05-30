"""add discord product channels

Revision ID: 20260529120000
Revises: 20260529100000
Create Date: 2026-05-29 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260529120000"
down_revision: str | Sequence[str] | None = "20260529100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "discord_guild_configs",
        sa.Column("moderation_log_channel_id", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "discord_guild_configs",
        sa.Column("welcome_channel_id", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("discord_guild_configs", "welcome_channel_id")
    op.drop_column("discord_guild_configs", "moderation_log_channel_id")
