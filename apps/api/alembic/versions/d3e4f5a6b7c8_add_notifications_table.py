"""add_notifications_table

新增站內通知（inbox）資料表。

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-04-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: str | None = "c2d3e4f5a6b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if "notifications" not in existing_tables:
        op.create_table(
            "notifications",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("type", sa.String(50), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("body", sa.Text, nullable=True),
            sa.Column("link", sa.String(500), nullable=True),
            sa.Column("is_read", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("related_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
        )

    existing_indexes = {idx["name"] for idx in inspector.get_indexes("notifications")} if "notifications" in existing_tables else set()

    if "ix_notifications_user_id" not in existing_indexes:
        op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    if "ix_notifications_is_read" not in existing_indexes:
        op.create_index("ix_notifications_is_read", "notifications", ["is_read"])


def downgrade() -> None:
    op.drop_index("ix_notifications_is_read", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
