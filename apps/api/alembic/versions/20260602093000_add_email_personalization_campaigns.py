"""add email personalization campaigns

Revision ID: 20260602093000
Revises: 20260531173000, 9a8b7c6d5e4f, a1b2c3d4e5f7, a7a7f56cc127, a7b8c9d0e1f2, e4b7c8d9a001, f5a6b7c8d9e0
Create Date: 2026-06-02 09:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260602093000"
down_revision: str | Sequence[str] | None = (
    "20260531173000",
    "9a8b7c6d5e4f",
    "a1b2c3d4e5f7",
    "a7a7f56cc127",
    "a7b8c9d0e1f2",
    "e4b7c8d9a001",
    "f5a6b7c8d9e0",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    json_type = postgresql.JSONB(astext_type=sa.Text())
    op.add_column(
        "email_messages",
        sa.Column(
            "variable_definitions",
            json_type,
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "email_messages",
        sa.Column(
            "default_variables",
            json_type,
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "email_messages",
        sa.Column(
            "recipient_variables",
            json_type,
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.create_table(
        "email_campaign_recipients",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("message_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("variables", json_type, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("celery_task_id", sa.String(length=100), nullable=True),
        sa.Column("provider_id", sa.String(length=100), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["email_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_campaign_recipients_email",
        "email_campaign_recipients",
        ["email"],
        unique=False,
    )
    op.create_index(
        "ix_email_campaign_recipients_message_id",
        "email_campaign_recipients",
        ["message_id"],
        unique=False,
    )
    op.create_index(
        "ix_email_campaign_recipients_message_status",
        "email_campaign_recipients",
        ["message_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_email_campaign_recipients_user_id",
        "email_campaign_recipients",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_email_campaign_recipients_user_id", table_name="email_campaign_recipients")
    op.drop_index(
        "ix_email_campaign_recipients_message_status",
        table_name="email_campaign_recipients",
    )
    op.drop_index("ix_email_campaign_recipients_message_id", table_name="email_campaign_recipients")
    op.drop_index("ix_email_campaign_recipients_email", table_name="email_campaign_recipients")
    op.drop_table("email_campaign_recipients")
    op.drop_column("email_messages", "recipient_variables")
    op.drop_column("email_messages", "default_variables")
    op.drop_column("email_messages", "variable_definitions")
