"""新增 Discord 治理政策、成員差異與治理工作區。

Revision ID: 20260612030000
Revises: 20260612020000
Create Date: 2026-06-12 03:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260612030000"
down_revision: str | None = "20260612020000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "discord_role_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("role_id", sa.String(length=32), nullable=False),
        sa.Column("role_name", sa.String(length=100), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("position_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("nickname_label", sa.String(length=20), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("manage_role", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("use_in_nickname", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("guild_id", "role_id", name="uq_discord_role_policy_role"),
    )
    op.create_index(
        "ix_discord_role_policy_target",
        "discord_role_policies",
        ["org_id", "position_id"],
    )
    op.create_index(
        "ix_discord_role_policy_active",
        "discord_role_policies",
        ["guild_id", "is_active"],
    )
    op.create_index(
        op.f("ix_discord_role_policies_guild_id"),
        "discord_role_policies",
        ["guild_id"],
    )
    op.create_index(
        op.f("ix_discord_role_policies_org_id"),
        "discord_role_policies",
        ["org_id"],
    )
    op.create_index(
        op.f("ix_discord_role_policies_position_id"),
        "discord_role_policies",
        ["position_id"],
    )
    op.create_index(
        op.f("ix_discord_role_policies_priority"),
        "discord_role_policies",
        ["priority"],
    )
    op.create_index(
        op.f("ix_discord_role_policies_is_active"),
        "discord_role_policies",
        ["is_active"],
    )

    op.execute(
        """
        INSERT INTO discord_role_policies (
            id, guild_id, role_id, org_id, position_id, nickname_label, priority,
            manage_role, use_in_nickname, is_active, created_at, updated_at
        )
        SELECT
            gen_random_uuid(), mapping.guild_id, mapping.role_id, mapping.org_id,
            mapping.position_id, prefix.prefix, COALESCE(prefix.priority, 100),
            true, prefix.prefix IS NOT NULL, mapping.is_active,
            mapping.created_at, mapping.updated_at
        FROM discord_role_mappings AS mapping
        LEFT JOIN LATERAL (
            SELECT rule.prefix, rule.priority
            FROM discord_nickname_prefix_rules AS rule
            WHERE rule.guild_id = mapping.guild_id
              AND rule.mapping_kind = mapping.mapping_kind
              AND (
                (mapping.mapping_kind = 'org' AND rule.org_id = mapping.org_id)
                OR
                (mapping.mapping_kind = 'position' AND rule.position_id = mapping.position_id)
              )
              AND rule.is_active = true
            ORDER BY rule.priority, rule.id
            LIMIT 1
        ) AS prefix ON true
        """
    )

    op.create_table(
        "discord_member_sync_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("discord_user_id", sa.String(length=32), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("base_nickname", sa.String(length=100), nullable=True),
        sa.Column("actual_nickname", sa.String(length=100), nullable=True),
        sa.Column("expected_nickname", sa.String(length=100), nullable=True),
        sa.Column("last_applied_prefix", sa.String(length=50), nullable=True),
        sa.Column(
            "actual_role_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "desired_role_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("has_role_drift", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=2000), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "guild_id",
            "discord_user_id",
            name="uq_discord_member_sync_state_member",
        ),
    )
    op.create_index(
        "ix_discord_member_sync_state_drift",
        "discord_member_sync_states",
        ["guild_id", "has_role_drift"],
    )
    for column in ("guild_id", "discord_user_id", "user_id", "has_role_drift"):
        op.create_index(
            op.f(f"ix_discord_member_sync_states_{column}"),
            "discord_member_sync_states",
            [column],
        )

    op.create_table(
        "governance_discord_workspaces",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("category_id", sa.String(length=32), nullable=True),
        sa.Column("discussion_channel_id", sa.String(length=32), nullable=True),
        sa.Column("announcement_channel_id", sa.String(length=32), nullable=True),
        sa.Column("staff_channel_id", sa.String(length=32), nullable=True),
        sa.Column("mention_role_id", sa.String(length=32), nullable=True),
        sa.Column("sync_status", sa.String(length=20), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_sync", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("matter_id", name="uq_governance_discord_workspace_matter"),
    )
    op.create_index(
        "ix_governance_discord_workspace_guild",
        "governance_discord_workspaces",
        ["guild_id", "is_active"],
    )

    op.create_table(
        "governance_discord_event_routes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=60), nullable=False),
        sa.Column("channel_kind", sa.String(length=20), nullable=False),
        sa.Column("channel_id", sa.String(length=32), nullable=True),
        sa.Column("create_thread", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("mention_role_id", sa.String(length=32), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["governance_discord_workspaces.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "event_type",
            name="uq_governance_discord_event_route",
        ),
    )
    op.create_index(
        op.f("ix_governance_discord_event_routes_workspace_id"),
        "governance_discord_event_routes",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_governance_discord_event_routes_workspace_id"),
        table_name="governance_discord_event_routes",
    )
    op.drop_table("governance_discord_event_routes")
    op.drop_index(
        "ix_governance_discord_workspace_guild",
        table_name="governance_discord_workspaces",
    )
    op.drop_table("governance_discord_workspaces")
    op.drop_index(
        "ix_discord_member_sync_state_drift",
        table_name="discord_member_sync_states",
    )
    for column in ("has_role_drift", "user_id", "discord_user_id", "guild_id"):
        op.drop_index(
            op.f(f"ix_discord_member_sync_states_{column}"),
            table_name="discord_member_sync_states",
        )
    op.drop_table("discord_member_sync_states")
    for name in (
        "ix_discord_role_policies_is_active",
        "ix_discord_role_policies_priority",
        "ix_discord_role_policies_position_id",
        "ix_discord_role_policies_org_id",
        "ix_discord_role_policies_guild_id",
    ):
        op.drop_index(name, table_name="discord_role_policies")
    op.drop_index("ix_discord_role_policy_active", table_name="discord_role_policies")
    op.drop_index("ix_discord_role_policy_target", table_name="discord_role_policies")
    op.drop_table("discord_role_policies")
