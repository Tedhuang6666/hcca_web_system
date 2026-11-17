"""add user google tasks config and work_item google_task_id

Revision ID: 20260705100000
Revises: 20260705000000
Create Date: 2026-07-05 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260705100000"
down_revision: str | Sequence[str] | None = "20260705000000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_google_tasks_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("access_token_enc", sa.Text, nullable=True),
        sa.Column("refresh_token_enc", sa.Text, nullable=True),
        sa.Column("token_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorized_email", sa.String(254), nullable=True),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("google_tasklist_id", sa.String(256), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("sync_enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", name="uq_user_google_tasks_configs_user"),
    )
    op.create_index(
        "ix_user_google_tasks_configs_user_id", "user_google_tasks_configs", ["user_id"]
    )

    op.add_column(
        "work_items",
        sa.Column("google_task_id", sa.String(256), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("work_items", "google_task_id")
    op.drop_index("ix_user_google_tasks_configs_user_id", table_name="user_google_tasks_configs")
    op.drop_table("user_google_tasks_configs")
