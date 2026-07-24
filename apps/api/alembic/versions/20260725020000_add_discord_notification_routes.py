"""add configurable Discord notification routes

Revision ID: 20260725020000
Revises: 20260725010000
Create Date: 2026-07-25 02:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260725020000"
down_revision: str | Sequence[str] | None = "20260725010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "discord_notification_routes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guild_id", sa.String(length=32), nullable=False),
        sa.Column("event_key", sa.String(length=80), nullable=False),
        sa.Column("module", sa.String(length=40), nullable=False),
        sa.Column("channel_id", sa.String(length=32), nullable=False),
        sa.Column("role_id", sa.String(length=32), nullable=True),
        sa.Column("petition_type_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("priority", sa.Integer(), server_default="100", nullable=False),
        sa.Column("mention_role", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["petition_type_id"], ["petition_types.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_discord_notification_routes_guild_id",
        "discord_notification_routes",
        ["guild_id"],
        unique=False,
    )
    op.create_index(
        "ix_discord_notification_route_event_active",
        "discord_notification_routes",
        ["event_key", "is_active"],
        unique=False,
    )
    op.create_index(
        "ix_discord_notification_route_filters",
        "discord_notification_routes",
        ["petition_type_id", "org_id"],
        unique=False,
    )
    op.create_index(
        "ix_discord_notification_routes_petition_type_id",
        "discord_notification_routes",
        ["petition_type_id"],
        unique=False,
    )
    op.create_index(
        "ix_discord_notification_routes_org_id",
        "discord_notification_routes",
        ["org_id"],
        unique=False,
    )
    op.create_index(
        "ix_discord_notification_routes_is_active",
        "discord_notification_routes",
        ["is_active"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_discord_notification_routes_is_active", table_name="discord_notification_routes")
    op.drop_index("ix_discord_notification_routes_org_id", table_name="discord_notification_routes")
    op.drop_index(
        "ix_discord_notification_routes_petition_type_id", table_name="discord_notification_routes"
    )
    op.drop_index("ix_discord_notification_route_filters", table_name="discord_notification_routes")
    op.drop_index(
        "ix_discord_notification_route_event_active", table_name="discord_notification_routes"
    )
    op.drop_index("ix_discord_notification_routes_guild_id", table_name="discord_notification_routes")
    op.drop_table("discord_notification_routes")
