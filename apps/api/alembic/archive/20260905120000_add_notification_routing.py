"""add notification routing and digest-only inbox rows"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260905120000"
down_revision: str | Sequence[str] | None = "20260905100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _json_list() -> sa.JSON:
    return sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("is_inapp_visible", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "merchandise_submission_settings",
        sa.Column("notification_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "merchandise_submission_settings",
        sa.Column("notification_recipient_ids", _json_list(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "merchandise_submission_items",
        sa.Column("notification_enabled", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "merchandise_submission_items",
        sa.Column("notification_recipient_ids", _json_list(), nullable=True),
    )

    op.create_table(
        "petition_notification_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("recipient_user_ids", _json_list(), nullable=False, server_default="[]"),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "petition_notification_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("petition_type_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("recipient_user_ids", _json_list(), nullable=False, server_default="[]"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "(petition_type_id IS NOT NULL) <> (org_id IS NOT NULL)",
            name="ck_petition_notification_rule_one_scope",
        ),
        sa.ForeignKeyConstraint(["petition_type_id"], ["petition_types.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("petition_type_id", name="uq_petition_notification_rule_type"),
        sa.UniqueConstraint("org_id", name="uq_petition_notification_rule_org"),
    )
    op.create_index(
        "ix_petition_notification_rules_type",
        "petition_notification_rules",
        ["petition_type_id"],
    )
    op.create_index(
        "ix_petition_notification_rules_org",
        "petition_notification_rules",
        ["org_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_petition_notification_rules_org", table_name="petition_notification_rules")
    op.drop_index("ix_petition_notification_rules_type", table_name="petition_notification_rules")
    op.drop_table("petition_notification_rules")
    op.drop_table("petition_notification_settings")
    op.drop_column("merchandise_submission_items", "notification_recipient_ids")
    op.drop_column("merchandise_submission_items", "notification_enabled")
    op.drop_column("merchandise_submission_settings", "notification_recipient_ids")
    op.drop_column("merchandise_submission_settings", "notification_enabled")
    op.drop_column("notifications", "is_inapp_visible")
