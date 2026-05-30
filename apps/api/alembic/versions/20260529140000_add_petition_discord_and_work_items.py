"""add petition discord private channels and work items

Revision ID: 20260529140000
Revises: 20260529130000
Create Date: 2026-05-29 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260529140000"
down_revision: str | Sequence[str] | None = "20260529130000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "discord_guild_configs",
        sa.Column("petition_private_category_id", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "discord_guild_configs",
        sa.Column("petition_staff_role_id", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "discord_guild_configs",
        sa.Column(
            "petition_private_channel_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.alter_column("discord_guild_configs", "petition_private_channel_enabled", server_default=None)

    op.add_column("petition_cases", sa.Column("discord_guild_id", sa.String(length=32), nullable=True))
    op.add_column(
        "petition_cases", sa.Column("discord_channel_id", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "petition_cases",
        sa.Column("discord_channel_created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_petition_cases_discord_channel_id"),
        "petition_cases",
        ["discord_channel_id"],
        unique=False,
    )

    op.create_table(
        "work_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("assigned_to_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_type", sa.String(length=50), nullable=True),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("discord_channel_id", sa.String(length=32), nullable=True),
        sa.Column("discord_message_id", sa.String(length=32), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["assigned_to_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_work_items_assigned_to_id"), "work_items", ["assigned_to_id"], unique=False
    )
    op.create_index(
        op.f("ix_work_items_created_by_id"), "work_items", ["created_by_id"], unique=False
    )
    op.create_index(op.f("ix_work_items_due_at"), "work_items", ["due_at"], unique=False)
    op.create_index(op.f("ix_work_items_is_active"), "work_items", ["is_active"], unique=False)
    op.create_index(op.f("ix_work_items_source_id"), "work_items", ["source_id"], unique=False)
    op.create_index(
        op.f("ix_work_items_source_type"), "work_items", ["source_type"], unique=False
    )
    op.create_index(op.f("ix_work_items_status"), "work_items", ["status"], unique=False)
    op.create_index(op.f("ix_work_items_title"), "work_items", ["title"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_work_items_title"), table_name="work_items")
    op.drop_index(op.f("ix_work_items_status"), table_name="work_items")
    op.drop_index(op.f("ix_work_items_source_type"), table_name="work_items")
    op.drop_index(op.f("ix_work_items_source_id"), table_name="work_items")
    op.drop_index(op.f("ix_work_items_is_active"), table_name="work_items")
    op.drop_index(op.f("ix_work_items_due_at"), table_name="work_items")
    op.drop_index(op.f("ix_work_items_created_by_id"), table_name="work_items")
    op.drop_index(op.f("ix_work_items_assigned_to_id"), table_name="work_items")
    op.drop_table("work_items")
    op.drop_index(op.f("ix_petition_cases_discord_channel_id"), table_name="petition_cases")
    op.drop_column("petition_cases", "discord_channel_created_at")
    op.drop_column("petition_cases", "discord_channel_id")
    op.drop_column("petition_cases", "discord_guild_id")
    op.drop_column("discord_guild_configs", "petition_private_channel_enabled")
    op.drop_column("discord_guild_configs", "petition_staff_role_id")
    op.drop_column("discord_guild_configs", "petition_private_category_id")
