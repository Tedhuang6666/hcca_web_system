"""add email_messages table

Revision ID: 20260517180000
Revises: 20260517170000
Create Date: 2026-05-17 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260517180000"
down_revision: str | Sequence[str] | None = "20260517170000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "email_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sender_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("template", sa.String(length=50), nullable=False, server_default="generic"),
        sa.Column("context", _JSON, nullable=False, server_default="{}"),
        sa.Column("recipient_spec", _JSON, nullable=False, server_default="{}"),
        sa.Column("resolved_emails", _JSON, nullable=False, server_default="[]"),
        sa.Column("recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("celery_task_id", sa.String(length=100), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_messages_sender_id", "email_messages", ["sender_id"])
    op.create_index(
        "ix_email_messages_status_scheduled", "email_messages", ["status", "scheduled_at"]
    )
    op.create_index(
        "ix_email_messages_sender_created", "email_messages", ["sender_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_email_messages_sender_created", table_name="email_messages")
    op.drop_index("ix_email_messages_status_scheduled", table_name="email_messages")
    op.drop_index("ix_email_messages_sender_id", table_name="email_messages")
    op.drop_table("email_messages")
