"""新增活動職務與 Discord 工作區。

Revision ID: 20260612020000
Revises: 20260612010000
Create Date: 2026-06-12 02:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260612020000"
down_revision: str | None = "20260612010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activity_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=60), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("discord_role_id", sa.String(length=32), nullable=True),
        sa.Column("discord_channel_id", sa.String(length=32), nullable=True),
        sa.Column("create_private_channel", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="100", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
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
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("activity_id", "key", name="uq_activity_role_key"),
    )
    op.create_index(
        "ix_activity_roles_active", "activity_roles", ["activity_id", "is_active"], unique=False
    )
    op.create_table(
        "activity_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
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
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["activity_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "activity_id", "role_id", "user_id", "start_date", name="uq_activity_member_term"
        ),
    )
    op.create_index(
        "ix_activity_members_active",
        "activity_members",
        ["activity_id", "user_id", "end_date"],
        unique=False,
    )
    op.create_table(
        "discord_activity_workspaces",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("category_id", sa.String(length=32), nullable=True),
        sa.Column("general_channel_id", sa.String(length=32), nullable=True),
        sa.Column("announcement_channel_id", sa.String(length=32), nullable=True),
        sa.Column("staff_channel_id", sa.String(length=32), nullable=True),
        sa.Column("convener_role_id", sa.String(length=32), nullable=True),
        sa.Column("sync_status", sa.String(length=20), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_sync", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
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
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("activity_id", name="uq_discord_activity_workspace_activity"),
    )
    op.create_index(
        "ix_discord_activity_workspace_guild",
        "discord_activity_workspaces",
        ["guild_id", "is_active"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_discord_activity_workspace_guild", table_name="discord_activity_workspaces")
    op.drop_table("discord_activity_workspaces")
    op.drop_index("ix_activity_members_active", table_name="activity_members")
    op.drop_table("activity_members")
    op.drop_index("ix_activity_roles_active", table_name="activity_roles")
    op.drop_table("activity_roles")
