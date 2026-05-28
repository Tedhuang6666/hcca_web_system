"""add discord integration

Revision ID: 20260526discord
Revises: 20260525040000
Create Date: 2026-05-26 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260526discord"
down_revision: str | Sequence[str] | None = "20260525040000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "discord_account_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("discord_user_id", sa.String(length=32), nullable=False),
        sa.Column("username", sa.String(length=100), nullable=True),
        sa.Column("global_name", sa.String(length=100), nullable=True),
        sa.Column("avatar_hash", sa.String(length=100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("discord_user_id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(
        "ix_discord_account_links_discord_user_id", "discord_account_links", ["discord_user_id"]
    )
    op.create_index("ix_discord_account_links_is_active", "discord_account_links", ["is_active"])
    op.create_index("ix_discord_account_links_user_id", "discord_account_links", ["user_id"])

    op.create_table(
        "discord_guild_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column("office_channel_id", sa.String(length=32), nullable=True),
        sa.Column("security_alert_channel_id", sa.String(length=32), nullable=True),
        sa.Column("petition_entry_channel_id", sa.String(length=32), nullable=True),
        sa.Column("announcement_channel_id", sa.String(length=32), nullable=True),
        sa.Column("admin_role_id", sa.String(length=32), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("guild_id"),
    )
    op.create_index("ix_discord_guild_configs_guild_id", "discord_guild_configs", ["guild_id"])
    op.create_index("ix_discord_guild_configs_is_active", "discord_guild_configs", ["is_active"])

    op.create_table(
        "discord_role_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("role_id", sa.String(length=32), nullable=False),
        sa.Column("mapping_kind", sa.String(length=20), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("position_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("guild_id", "role_id", name="uq_discord_role_mapping_role"),
    )
    op.create_index(
        "ix_discord_role_mapping_target",
        "discord_role_mappings",
        ["mapping_kind", "org_id", "position_id"],
    )
    op.create_index("ix_discord_role_mappings_guild_id", "discord_role_mappings", ["guild_id"])
    op.create_index("ix_discord_role_mappings_is_active", "discord_role_mappings", ["is_active"])
    op.create_index("ix_discord_role_mappings_org_id", "discord_role_mappings", ["org_id"])
    op.create_index(
        "ix_discord_role_mappings_position_id", "discord_role_mappings", ["position_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_discord_role_mappings_position_id", table_name="discord_role_mappings")
    op.drop_index("ix_discord_role_mappings_org_id", table_name="discord_role_mappings")
    op.drop_index("ix_discord_role_mappings_is_active", table_name="discord_role_mappings")
    op.drop_index("ix_discord_role_mappings_guild_id", table_name="discord_role_mappings")
    op.drop_index("ix_discord_role_mapping_target", table_name="discord_role_mappings")
    op.drop_table("discord_role_mappings")
    op.drop_index("ix_discord_guild_configs_is_active", table_name="discord_guild_configs")
    op.drop_index("ix_discord_guild_configs_guild_id", table_name="discord_guild_configs")
    op.drop_table("discord_guild_configs")
    op.drop_index("ix_discord_account_links_user_id", table_name="discord_account_links")
    op.drop_index("ix_discord_account_links_is_active", table_name="discord_account_links")
    op.drop_index("ix_discord_account_links_discord_user_id", table_name="discord_account_links")
    op.drop_table("discord_account_links")
