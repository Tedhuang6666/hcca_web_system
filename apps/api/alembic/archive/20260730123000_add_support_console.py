"""建立客服作業平台資料表。

Revision ID: 20260730123000
Revises: 20260730120000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260730123000"
down_revision: str | Sequence[str] | None = "20260730120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
JSON = postgresql.JSONB


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "support_tickets",
        sa.Column("id", UUID, nullable=False),
        sa.Column("ticket_number", sa.String(32), nullable=False, unique=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("user_id", UUID, nullable=True),
        sa.Column("reported_by_user_id", UUID, nullable=True),
        sa.Column("assigned_to_id", UUID, nullable=True),
        sa.Column("channel", sa.String(32), nullable=False, server_default="internal"),
        sa.Column("priority", sa.String(16), nullable=False, server_default="normal"),
        sa.Column("status", sa.String(24), nullable=False, server_default="new"),
        sa.Column("error_code", sa.String(128), nullable=True),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("related_data", JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        _created_at(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reported_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_to_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_support_tickets_ticket_number", ["ticket_number"]),
        ("ix_support_tickets_status", ["status"]),
        ("ix_support_tickets_priority", ["priority"]),
        ("ix_support_tickets_user_id", ["user_id"]),
        ("ix_support_tickets_assigned_to_id", ["assigned_to_id"]),
        ("ix_support_tickets_request_id", ["request_id"]),
        ("ix_support_tickets_error_code", ["error_code"]),
        ("ix_support_tickets_status_priority", ["status", "priority"]),
        ("ix_support_tickets_user_status", ["user_id", "status"]),
    ):
        op.create_index(name, "support_tickets", columns)

    op.create_table(
        "support_ticket_events",
        sa.Column("id", UUID, nullable=False),
        sa.Column("ticket_id", UUID, nullable=False),
        sa.Column("actor_user_id", UUID, nullable=True),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("metadata", JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        _created_at(),
        sa.ForeignKeyConstraint(["ticket_id"], ["support_tickets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_ticket_events_ticket_created",
        "support_ticket_events",
        ["ticket_id", "created_at"],
    )

    op.create_table(
        "support_audit_logs",
        sa.Column("id", UUID, nullable=False),
        sa.Column("actor_user_id", UUID, nullable=False),
        sa.Column("target_user_id", UUID, nullable=True),
        sa.Column("ticket_id", UUID, nullable=True),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=False),
        sa.Column("resource_id", sa.String(128), nullable=True),
        sa.Column("risk_level", sa.String(16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("before_data", JSON, nullable=True),
        sa.Column("after_data", JSON, nullable=True),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        _created_at(),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["ticket_id"], ["support_tickets.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_audit_actor_created", "support_audit_logs", ["actor_user_id", "created_at"]
    )
    op.create_index(
        "ix_support_audit_target_created", "support_audit_logs", ["target_user_id", "created_at"]
    )
    op.create_index(
        "ix_support_audit_ticket_created", "support_audit_logs", ["ticket_id", "created_at"]
    )
    op.create_index("ix_support_audit_action", "support_audit_logs", ["action"])

    op.create_table(
        "support_approvals",
        sa.Column("id", UUID, nullable=False),
        sa.Column("approval_number", sa.String(32), nullable=False, unique=True),
        sa.Column("requested_by", UUID, nullable=False),
        sa.Column("approved_by", UUID, nullable=True),
        sa.Column("ticket_id", UUID, nullable=True),
        sa.Column("target_user_id", UUID, nullable=True),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("payload", JSON, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("risk_level", sa.String(16), nullable=False, server_default="high"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("result", JSON, nullable=True),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["ticket_id"], ["support_tickets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_approvals_approval_number", "support_approvals", ["approval_number"]
    )
    op.create_index("ix_support_approvals_status", "support_approvals", ["status"])
    op.create_index(
        "ix_support_approvals_status_requested", "support_approvals", ["status", "requested_at"]
    )

    op.create_table(
        "support_impersonation_sessions",
        sa.Column("id", UUID, nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("real_user_id", UUID, nullable=False),
        sa.Column("impersonated_user_id", UUID, nullable=False),
        sa.Column("ticket_id", UUID, nullable=False),
        sa.Column("mode", sa.String(16), nullable=False, server_default="read_only"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.ForeignKeyConstraint(["real_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["impersonated_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["ticket_id"], ["support_tickets.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_impersonation_token_hash", "support_impersonation_sessions", ["token_hash"]
    )
    op.create_index(
        "ix_support_impersonation_target_expires",
        "support_impersonation_sessions",
        ["impersonated_user_id", "expires_at"],
    )

    op.create_table(
        "support_assistance_sessions",
        sa.Column("id", UUID, nullable=False),
        sa.Column("assistance_code", sa.String(6), nullable=False, unique=True),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("support_user_id", UUID, nullable=False),
        sa.Column("ticket_id", UUID, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="waiting"),
        sa.Column("current_route", sa.String(512), nullable=True),
        sa.Column("client_state", JSON, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["support_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["ticket_id"], ["support_tickets.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_assistance_assistance_code", "support_assistance_sessions", ["assistance_code"]
    )
    op.create_index("ix_support_assistance_status", "support_assistance_sessions", ["status"])
    op.create_index(
        "ix_support_assistance_target_status", "support_assistance_sessions", ["user_id", "status"]
    )

    op.create_table(
        "support_guide_entries",
        sa.Column("id", UUID, nullable=False),
        sa.Column("slug", sa.String(120), nullable=False, unique=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("category", sa.String(64), nullable=False, server_default="general"),
        sa.Column(
            "required_permissions", JSON, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("route", sa.String(512), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_id", UUID, nullable=True),
        sa.Column("updated_by_id", UUID, nullable=True),
        _created_at(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_support_guide_entries_slug", "support_guide_entries", ["slug"])
    op.create_index("ix_support_guide_entries_is_active", "support_guide_entries", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_support_guide_entries_is_active", table_name="support_guide_entries")
    op.drop_index("ix_support_guide_entries_slug", table_name="support_guide_entries")
    op.drop_table("support_guide_entries")
    op.drop_index("ix_support_assistance_target_status", table_name="support_assistance_sessions")
    op.drop_index("ix_support_assistance_status", table_name="support_assistance_sessions")
    op.drop_index("ix_support_assistance_assistance_code", table_name="support_assistance_sessions")
    op.drop_table("support_assistance_sessions")
    op.drop_index(
        "ix_support_impersonation_target_expires", table_name="support_impersonation_sessions"
    )
    op.drop_index(
        "ix_support_impersonation_token_hash", table_name="support_impersonation_sessions"
    )
    op.drop_table("support_impersonation_sessions")
    op.drop_index("ix_support_approvals_status_requested", table_name="support_approvals")
    op.drop_index("ix_support_approvals_status", table_name="support_approvals")
    op.drop_index("ix_support_approvals_approval_number", table_name="support_approvals")
    op.drop_table("support_approvals")
    op.drop_index("ix_support_audit_action", table_name="support_audit_logs")
    op.drop_index("ix_support_audit_ticket_created", table_name="support_audit_logs")
    op.drop_index("ix_support_audit_target_created", table_name="support_audit_logs")
    op.drop_index("ix_support_audit_actor_created", table_name="support_audit_logs")
    op.drop_table("support_audit_logs")
    op.drop_index("ix_support_ticket_events_ticket_created", table_name="support_ticket_events")
    op.drop_table("support_ticket_events")
    for name in (
        "ix_support_tickets_user_status",
        "ix_support_tickets_status_priority",
        "ix_support_tickets_error_code",
        "ix_support_tickets_request_id",
        "ix_support_tickets_assigned_to_id",
        "ix_support_tickets_user_id",
        "ix_support_tickets_priority",
        "ix_support_tickets_status",
        "ix_support_tickets_ticket_number",
    ):
        op.drop_index(name, table_name="support_tickets")
    op.drop_table("support_tickets")
