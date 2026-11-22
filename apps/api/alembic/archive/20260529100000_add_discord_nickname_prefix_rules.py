"""add discord nickname prefix rules

Revision ID: 20260529100000
Revises: 20260528110000
Create Date: 2026-05-29 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260529100000"
down_revision: str | Sequence[str] | None = "20260528110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "discord_nickname_prefix_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("prefix", sa.String(length=20), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
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
    )
    op.create_index(
        "ix_discord_nickname_prefix_rule_active",
        "discord_nickname_prefix_rules",
        ["guild_id", "is_active"],
    )
    op.create_index(
        "ix_discord_nickname_prefix_rule_target",
        "discord_nickname_prefix_rules",
        ["mapping_kind", "org_id", "position_id"],
    )
    op.create_index(
        "ix_discord_nickname_prefix_rules_guild_id",
        "discord_nickname_prefix_rules",
        ["guild_id"],
    )
    op.create_index(
        "ix_discord_nickname_prefix_rules_is_active",
        "discord_nickname_prefix_rules",
        ["is_active"],
    )
    op.create_index(
        "ix_discord_nickname_prefix_rules_org_id",
        "discord_nickname_prefix_rules",
        ["org_id"],
    )
    op.create_index(
        "ix_discord_nickname_prefix_rules_position_id",
        "discord_nickname_prefix_rules",
        ["position_id"],
    )
    op.create_index(
        "ix_discord_nickname_prefix_rules_priority",
        "discord_nickname_prefix_rules",
        ["priority"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_discord_nickname_prefix_rules_priority",
        table_name="discord_nickname_prefix_rules",
    )
    op.drop_index(
        "ix_discord_nickname_prefix_rules_position_id",
        table_name="discord_nickname_prefix_rules",
    )
    op.drop_index(
        "ix_discord_nickname_prefix_rules_org_id",
        table_name="discord_nickname_prefix_rules",
    )
    op.drop_index(
        "ix_discord_nickname_prefix_rules_is_active",
        table_name="discord_nickname_prefix_rules",
    )
    op.drop_index(
        "ix_discord_nickname_prefix_rules_guild_id",
        table_name="discord_nickname_prefix_rules",
    )
    op.drop_index(
        "ix_discord_nickname_prefix_rule_target",
        table_name="discord_nickname_prefix_rules",
    )
    op.drop_index(
        "ix_discord_nickname_prefix_rule_active",
        table_name="discord_nickname_prefix_rules",
    )
    op.drop_table("discord_nickname_prefix_rules")
