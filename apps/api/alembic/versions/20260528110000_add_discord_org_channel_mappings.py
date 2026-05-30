"""add discord org channel mappings

Revision ID: 20260528110000
Revises: 20260527120000
Create Date: 2026-05-28 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260528110000"
down_revision: str | Sequence[str] | None = "20260527120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "discord_org_channel_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", sa.String(length=32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("guild_id", "org_id", name="uq_discord_org_channel_mapping_org"),
    )
    op.create_index(
        "ix_discord_org_channel_mapping_active",
        "discord_org_channel_mappings",
        ["guild_id", "is_active"],
    )
    op.create_index(
        "ix_discord_org_channel_mappings_guild_id",
        "discord_org_channel_mappings",
        ["guild_id"],
    )
    op.create_index(
        "ix_discord_org_channel_mappings_is_active",
        "discord_org_channel_mappings",
        ["is_active"],
    )
    op.create_index(
        "ix_discord_org_channel_mappings_org_id",
        "discord_org_channel_mappings",
        ["org_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_discord_org_channel_mappings_org_id", table_name="discord_org_channel_mappings"
    )
    op.drop_index(
        "ix_discord_org_channel_mappings_is_active", table_name="discord_org_channel_mappings"
    )
    op.drop_index(
        "ix_discord_org_channel_mappings_guild_id", table_name="discord_org_channel_mappings"
    )
    op.drop_index(
        "ix_discord_org_channel_mapping_active", table_name="discord_org_channel_mappings"
    )
    op.drop_table("discord_org_channel_mappings")
