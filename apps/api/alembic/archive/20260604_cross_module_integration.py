"""cross module activity finance publication integration

Revision ID: 20260604crossmodule
Revises: 8ee2f4be16ce
Create Date: 2026-06-04 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260604crossmodule"
down_revision: Union[str, Sequence[str], None] = "8ee2f4be16ce"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("meetings", sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_meetings_activity_id_activities",
        "meetings",
        "activities",
        ["activity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_meetings_activity_id", "meetings", ["activity_id"])

    op.create_table(
        "activity_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_type", sa.String(length=50), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("href", sa.String(length=500), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("activity_id", "target_type", "target_id", name="uq_activity_link_target"),
    )
    op.create_index("ix_activity_links_activity_type", "activity_links", ["activity_id", "target_type"])
    op.create_index("ix_activity_links_target", "activity_links", ["target_type", "target_id"])
    op.create_index("ix_activity_links_created_by_id", "activity_links", ["created_by_id"])

    op.create_table(
        "receivables",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("paid_amount", sa.Integer(), nullable=False),
        sa.Column("refunded_amount", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("collected_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["collected_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_type", "source_id", name="uq_receivables_source"),
    )
    op.create_index("ix_receivables_activity_status", "receivables", ["activity_id", "status"])
    op.create_index("ix_receivables_class_status", "receivables", ["class_id", "status"])
    op.create_index("ix_receivables_user_status", "receivables", ["user_id", "status"])
    op.create_index("ix_receivables_org_id", "receivables", ["org_id"])
    op.create_index("ix_receivables_source_type", "receivables", ["source_type"])
    op.create_index("ix_receivables_status", "receivables", ["status"])

    op.create_table(
        "publication_campaigns",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=True),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("audience_type", sa.String(length=50), nullable=False),
        sa.Column("audience_filter", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("channels", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_publication_campaigns_activity_status", "publication_campaigns", ["activity_id", "status"])
    op.create_index("ix_publication_campaigns_source", "publication_campaigns", ["source_type", "source_id"])
    op.create_index("ix_publication_campaigns_created_by_id", "publication_campaigns", ["created_by_id"])
    op.create_index("ix_publication_campaigns_status", "publication_campaigns", ["status"])

    op.create_table(
        "publication_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel", sa.String(length=30), nullable=False),
        sa.Column("recipient_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("target", sa.String(length=255), nullable=True),
        sa.Column("provider_message_id", sa.String(length=255), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clicked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["publication_campaigns.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_publication_deliveries_campaign_channel", "publication_deliveries", ["campaign_id", "channel"])
    op.create_index("ix_publication_deliveries_recipient_user_id", "publication_deliveries", ["recipient_user_id"])
    op.create_index("ix_publication_deliveries_status", "publication_deliveries", ["status"])

    op.create_table(
        "workflow_instances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_type", sa.String(length=50), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("current_step", sa.String(length=80), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_type", "source_id", name="uq_workflow_instances_source"),
    )
    op.create_index("ix_workflow_instances_activity", "workflow_instances", ["activity_id"])
    op.create_index("ix_workflow_instances_created_by_id", "workflow_instances", ["created_by_id"])
    op.create_index("ix_workflow_instances_is_active", "workflow_instances", ["is_active"])
    op.create_index("ix_workflow_instances_source", "workflow_instances", ["source_type", "source_id"])
    op.create_index("ix_workflow_instances_source_id", "workflow_instances", ["source_id"])
    op.create_index("ix_workflow_instances_source_type", "workflow_instances", ["source_type"])
    op.create_index("ix_workflow_instances_status", "workflow_instances", ["status"])
    op.create_index("ix_workflow_instances_type_status", "workflow_instances", ["workflow_type", "status"])

    op.create_table(
        "workflow_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("instance_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("from_status", sa.String(length=50), nullable=True),
        sa.Column("to_status", sa.String(length=50), nullable=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_email", sa.String(length=255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["instance_id"], ["workflow_instances.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_events_actor_id", "workflow_events", ["actor_id"])
    op.create_index("ix_workflow_events_event_type", "workflow_events", ["event_type"])
    op.create_index("ix_workflow_events_instance_created", "workflow_events", ["instance_id", "created_at"])
    op.create_index("ix_workflow_events_instance_id", "workflow_events", ["instance_id"])
    op.create_index("ix_workflow_events_instance_type", "workflow_events", ["instance_id", "event_type"])

    op.create_table(
        "workflow_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("instance_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_type", sa.String(length=50), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("relation", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("href", sa.String(length=500), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["instance_id"], ["workflow_instances.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("instance_id", "target_type", "target_id", "relation", name="uq_workflow_link_target"),
    )
    op.create_index("ix_workflow_links_created_by_id", "workflow_links", ["created_by_id"])
    op.create_index("ix_workflow_links_instance_id", "workflow_links", ["instance_id"])
    op.create_index("ix_workflow_links_instance_type", "workflow_links", ["instance_id", "target_type"])
    op.create_index("ix_workflow_links_target", "workflow_links", ["target_type", "target_id"])
    op.create_index("ix_workflow_links_target_type", "workflow_links", ["target_type"])


def downgrade() -> None:
    op.drop_index("ix_workflow_links_target_type", table_name="workflow_links")
    op.drop_index("ix_workflow_links_target", table_name="workflow_links")
    op.drop_index("ix_workflow_links_instance_type", table_name="workflow_links")
    op.drop_index("ix_workflow_links_instance_id", table_name="workflow_links")
    op.drop_index("ix_workflow_links_created_by_id", table_name="workflow_links")
    op.drop_table("workflow_links")
    op.drop_index("ix_workflow_events_instance_type", table_name="workflow_events")
    op.drop_index("ix_workflow_events_instance_id", table_name="workflow_events")
    op.drop_index("ix_workflow_events_instance_created", table_name="workflow_events")
    op.drop_index("ix_workflow_events_event_type", table_name="workflow_events")
    op.drop_index("ix_workflow_events_actor_id", table_name="workflow_events")
    op.drop_table("workflow_events")
    op.drop_index("ix_workflow_instances_type_status", table_name="workflow_instances")
    op.drop_index("ix_workflow_instances_status", table_name="workflow_instances")
    op.drop_index("ix_workflow_instances_source_type", table_name="workflow_instances")
    op.drop_index("ix_workflow_instances_source_id", table_name="workflow_instances")
    op.drop_index("ix_workflow_instances_source", table_name="workflow_instances")
    op.drop_index("ix_workflow_instances_is_active", table_name="workflow_instances")
    op.drop_index("ix_workflow_instances_created_by_id", table_name="workflow_instances")
    op.drop_index("ix_workflow_instances_activity", table_name="workflow_instances")
    op.drop_table("workflow_instances")
    op.drop_index("ix_publication_deliveries_status", table_name="publication_deliveries")
    op.drop_index("ix_publication_deliveries_recipient_user_id", table_name="publication_deliveries")
    op.drop_index("ix_publication_deliveries_campaign_channel", table_name="publication_deliveries")
    op.drop_table("publication_deliveries")
    op.drop_index("ix_publication_campaigns_status", table_name="publication_campaigns")
    op.drop_index("ix_publication_campaigns_created_by_id", table_name="publication_campaigns")
    op.drop_index("ix_publication_campaigns_source", table_name="publication_campaigns")
    op.drop_index("ix_publication_campaigns_activity_status", table_name="publication_campaigns")
    op.drop_table("publication_campaigns")
    op.drop_index("ix_receivables_status", table_name="receivables")
    op.drop_index("ix_receivables_source_type", table_name="receivables")
    op.drop_index("ix_receivables_org_id", table_name="receivables")
    op.drop_index("ix_receivables_user_status", table_name="receivables")
    op.drop_index("ix_receivables_class_status", table_name="receivables")
    op.drop_index("ix_receivables_activity_status", table_name="receivables")
    op.drop_table("receivables")
    op.drop_index("ix_activity_links_created_by_id", table_name="activity_links")
    op.drop_index("ix_activity_links_target", table_name="activity_links")
    op.drop_index("ix_activity_links_activity_type", table_name="activity_links")
    op.drop_table("activity_links")
    op.drop_index("ix_meetings_activity_id", table_name="meetings")
    op.drop_constraint("fk_meetings_activity_id_activities", "meetings", type_="foreignkey")
    op.drop_column("meetings", "activity_id")
