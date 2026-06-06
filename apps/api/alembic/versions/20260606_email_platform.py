"""電子郵件行政平台：範本、名單、附件、追蹤事件與 suppression。

Revises: 20260606govingest
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260606emailplatform"
down_revision: str | Sequence[str] | None = "20260606govingest"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = postgresql.JSONB(astext_type=sa.Text())
UUID = postgresql.UUID(as_uuid=True)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "email_templates",
        sa.Column("id", UUID, nullable=False),
        sa.Column("owner_id", UUID, nullable=False),
        sa.Column("org_id", UUID, nullable=True),
        sa.Column("visibility", sa.String(length=20), server_default="private", nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), server_default="", nullable=False),
        sa.Column("content", JSON, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column(
            "variable_definitions", JSON, server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column("is_favorite", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("current_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_templates_owner_updated", "email_templates", ["owner_id", "updated_at"])
    op.create_index("ix_email_templates_org_active", "email_templates", ["org_id", "is_active"])

    op.create_table(
        "email_template_versions",
        sa.Column("id", UUID, nullable=False),
        sa.Column("template_id", UUID, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", JSON, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column(
            "variable_definitions", JSON, server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column("created_by_id", UUID, nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["template_id"], ["email_templates.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("template_id", "version", name="uq_email_template_version"),
    )
    op.create_index(
        "ix_email_template_versions_template_id",
        "email_template_versions",
        ["template_id"],
    )

    op.create_table(
        "email_recipient_lists",
        sa.Column("id", UUID, nullable=False),
        sa.Column("owner_id", UUID, nullable=False),
        sa.Column("org_id", UUID, nullable=True),
        sa.Column("visibility", sa.String(length=20), server_default="private", nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), server_default="", nullable=False),
        sa.Column("recipient_spec", JSON, server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column(
            "variable_definitions", JSON, server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_email_recipient_lists_owner_updated",
        "email_recipient_lists",
        ["owner_id", "updated_at"],
    )
    op.create_index(
        "ix_email_recipient_lists_org_active",
        "email_recipient_lists",
        ["org_id", "is_active"],
    )

    op.create_table(
        "email_recipient_list_members",
        sa.Column("id", UUID, nullable=False),
        sa.Column("list_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("variables", JSON, server_default=sa.text("'{}'::jsonb"), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["list_id"], ["email_recipient_lists.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("list_id", "email", name="uq_email_recipient_list_email"),
    )
    op.create_index(
        "ix_email_recipient_list_members_list_id",
        "email_recipient_list_members",
        ["list_id"],
    )

    op.add_column("email_messages", sa.Column("org_id", UUID, nullable=True))
    op.add_column("email_messages", sa.Column("template_id", UUID, nullable=True))
    op.add_column(
        "email_messages",
        sa.Column("track_opens", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.add_column(
        "email_messages",
        sa.Column("track_clicks", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.add_column("email_messages", sa.Column("idempotency_key", sa.String(length=100), nullable=True))
    op.create_foreign_key(
        "fk_email_messages_org_id", "email_messages", "orgs", ["org_id"], ["id"], ondelete="SET NULL"
    )
    op.create_foreign_key(
        "fk_email_messages_template_id",
        "email_messages",
        "email_templates",
        ["template_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_email_messages_org_id", "email_messages", ["org_id"])
    op.create_index("ix_email_messages_template_id", "email_messages", ["template_id"])
    op.create_index(
        "ix_email_messages_idempotency_key",
        "email_messages",
        ["idempotency_key"],
        unique=True,
    )

    for name in (
        "delivered_at",
        "first_opened_at",
        "last_opened_at",
        "first_clicked_at",
        "last_clicked_at",
        "bounced_at",
        "complained_at",
    ):
        op.add_column(
            "email_campaign_recipients",
            sa.Column(name, sa.DateTime(timezone=True), nullable=True),
        )

    op.create_table(
        "email_attachments",
        sa.Column("id", UUID, nullable=False),
        sa.Column("message_id", UUID, nullable=True),
        sa.Column("template_id", UUID, nullable=True),
        sa.Column("uploaded_by_id", UUID, nullable=True),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("delivery_mode", sa.String(length=20), server_default="attachment", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["message_id"], ["email_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["email_templates.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_attachments_message", "email_attachments", ["message_id"])
    op.create_index("ix_email_attachments_template", "email_attachments", ["template_id"])

    op.create_table(
        "email_recipient_events",
        sa.Column("id", UUID, nullable=False),
        sa.Column("recipient_id", UUID, nullable=False),
        sa.Column("provider_event_id", sa.String(length=150), nullable=False),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("payload", JSON, server_default=sa.text("'{}'::jsonb"), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["recipient_id"], ["email_campaign_recipients.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_event_id", name="uq_email_recipient_provider_event"),
    )
    op.create_index(
        "ix_email_recipient_events_recipient_type",
        "email_recipient_events",
        ["recipient_id", "event_type"],
    )

    op.create_table(
        "email_suppressions",
        sa.Column("id", UUID, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("reason", sa.String(length=30), nullable=False),
        sa.Column("source", sa.String(length=50), server_default="system", nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("suppressed_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_email_suppressions_email", "email_suppressions", ["email"], unique=True)
    op.create_index(
        "ix_email_suppressions_active_reason", "email_suppressions", ["is_active", "reason"]
    )


def downgrade() -> None:
    op.drop_table("email_suppressions")
    op.drop_table("email_recipient_events")
    op.drop_table("email_attachments")
    for name in (
        "complained_at",
        "bounced_at",
        "last_clicked_at",
        "first_clicked_at",
        "last_opened_at",
        "first_opened_at",
        "delivered_at",
    ):
        op.drop_column("email_campaign_recipients", name)
    op.drop_index("ix_email_messages_idempotency_key", table_name="email_messages")
    op.drop_index("ix_email_messages_template_id", table_name="email_messages")
    op.drop_index("ix_email_messages_org_id", table_name="email_messages")
    op.drop_constraint("fk_email_messages_template_id", "email_messages", type_="foreignkey")
    op.drop_constraint("fk_email_messages_org_id", "email_messages", type_="foreignkey")
    op.drop_column("email_messages", "idempotency_key")
    op.drop_column("email_messages", "track_clicks")
    op.drop_column("email_messages", "track_opens")
    op.drop_column("email_messages", "template_id")
    op.drop_column("email_messages", "org_id")
    op.drop_table("email_recipient_list_members")
    op.drop_table("email_recipient_lists")
    op.drop_table("email_template_versions")
    op.drop_table("email_templates")
