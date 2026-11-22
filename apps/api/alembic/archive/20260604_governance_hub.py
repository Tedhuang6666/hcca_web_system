"""governance hub matter program case

Revision ID: 20260604governance
Revises: 20260604simplemode
Create Date: 2026-06-04 22:30:00.000000

新增事情導向治理中樞：
- matters：事情主檔
- programs：大型事情下的專案
- governance_cases：行政案件
- entity_relations：通用關聯圖譜
- timeline_events：行政時間軸
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260604governance"
down_revision: str | Sequence[str] | None = "20260604simplemode"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "matters",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("matter_type", sa.String(length=40), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("priority", sa.String(length=20), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("progress_percent", sa.Integer(), nullable=False),
        sa.Column("meta", _jsonb(), server_default="{}", nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_matters_title", "matters", ["title"])
    op.create_index("ix_matters_org_status", "matters", ["org_id", "status"])
    op.create_index("ix_matters_owner_status", "matters", ["owner_user_id", "status"])
    op.create_index("ix_matters_type_status", "matters", ["matter_type", "status"])
    op.create_index("ix_matters_is_active", "matters", ["is_active"])
    op.create_index("ix_matters_status", "matters", ["status"])
    op.create_index("ix_matters_priority", "matters", ["priority"])
    op.create_index("ix_matters_visibility", "matters", ["visibility"])

    op.create_table(
        "programs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("matter_id", "name", name="uq_programs_matter_name"),
    )
    op.create_index("ix_programs_matter_id", "programs", ["matter_id"])
    op.create_index("ix_programs_matter_status", "programs", ["matter_id", "status"])
    op.create_index("ix_programs_is_active", "programs", ["is_active"])
    op.create_index("ix_programs_status", "programs", ["status"])

    op.create_table(
        "governance_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("program_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("case_type", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("current_step", sa.String(length=100), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta", _jsonb(), server_default="{}", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["program_id"], ["programs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_governance_cases_title", "governance_cases", ["title"])
    op.create_index("ix_governance_cases_matter_id", "governance_cases", ["matter_id"])
    op.create_index("ix_governance_cases_program_id", "governance_cases", ["program_id"])
    op.create_index("ix_governance_cases_owner_user_id", "governance_cases", ["owner_user_id"])
    op.create_index("ix_governance_cases_status", "governance_cases", ["status"])
    op.create_index("ix_governance_cases_is_active", "governance_cases", ["is_active"])
    op.create_index(
        "ix_governance_cases_matter_status", "governance_cases", ["matter_id", "status"]
    )
    op.create_index(
        "ix_governance_cases_program_status", "governance_cases", ["program_id", "status"]
    )
    op.create_index(
        "ix_governance_cases_owner_status", "governance_cases", ["owner_user_id", "status"]
    )

    op.create_table(
        "decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_type", sa.String(length=50), nullable=True),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta", _jsonb(), server_default="{}", nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["governance_cases.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_decisions_title", "decisions", ["title"])
    op.create_index("ix_decisions_status", "decisions", ["status"])
    op.create_index("ix_decisions_matter_id", "decisions", ["matter_id"])
    op.create_index("ix_decisions_case_id", "decisions", ["case_id"])
    op.create_index("ix_decisions_source_type", "decisions", ["source_type"])
    op.create_index("ix_decisions_owner_user_id", "decisions", ["owner_user_id"])
    op.create_index("ix_decisions_matter_status", "decisions", ["matter_id", "status"])
    op.create_index("ix_decisions_owner_status", "decisions", ["owner_user_id", "status"])
    op.create_index("ix_decisions_source", "decisions", ["source_type", "source_id"])

    op.create_table(
        "planning_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta", _jsonb(), server_default="{}", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["governance_cases.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_planning_documents_title", "planning_documents", ["title"])
    op.create_index("ix_planning_documents_status", "planning_documents", ["status"])
    op.create_index("ix_planning_documents_matter_id", "planning_documents", ["matter_id"])
    op.create_index("ix_planning_documents_case", "planning_documents", ["case_id"])
    op.create_index("ix_planning_documents_is_active", "planning_documents", ["is_active"])
    op.create_index(
        "ix_planning_documents_matter_status", "planning_documents", ["matter_id", "status"]
    )

    op.create_table(
        "planning_document_revisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("version_label", sa.String(length=80), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("change_reason", sa.Text(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_id"], ["planning_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "document_id",
            "version_number",
            name="uq_planning_document_revision_version",
        ),
    )
    op.create_index(
        "ix_planning_document_revisions_document_id",
        "planning_document_revisions",
        ["document_id"],
    )
    op.create_index(
        "ix_planning_document_revisions_document",
        "planning_document_revisions",
        ["document_id", "version_number"],
    )

    op.create_table(
        "matter_role_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role_name", sa.String(length=120), nullable=False),
        sa.Column("unit_name", sa.String(length=120), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["matter_role_assignments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_matter_role_assignments_matter_id", "matter_role_assignments", ["matter_id"]
    )
    op.create_index(
        "ix_matter_role_assignments_parent_id", "matter_role_assignments", ["parent_id"]
    )
    op.create_index("ix_matter_role_assignments_user_id", "matter_role_assignments", ["user_id"])
    op.create_index(
        "ix_matter_role_assignments_is_active", "matter_role_assignments", ["is_active"]
    )
    op.create_index(
        "ix_matter_role_assignments_matter",
        "matter_role_assignments",
        ["matter_id", "parent_id"],
    )
    op.create_index("ix_matter_role_assignments_user", "matter_role_assignments", ["user_id"])

    op.create_table(
        "governance_workflow_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("template_type", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("steps", _jsonb(), server_default="[]", nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", "version", name="uq_governance_workflow_template_version"),
    )
    op.create_index(
        "ix_governance_workflow_templates_template_type",
        "governance_workflow_templates",
        ["template_type"],
    )
    op.create_index(
        "ix_governance_workflow_templates_is_active",
        "governance_workflow_templates",
        ["is_active"],
    )
    op.create_index(
        "ix_governance_workflow_templates_type",
        "governance_workflow_templates",
        ["template_type", "is_active"],
    )

    op.create_table(
        "automation_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("trigger_type", sa.String(length=80), nullable=False),
        sa.Column("conditions", _jsonb(), server_default="{}", nullable=False),
        sa.Column("actions", _jsonb(), server_default="[]", nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_automation_rules_trigger_type", "automation_rules", ["trigger_type"])
    op.create_index("ix_automation_rules_status", "automation_rules", ["status"])
    op.create_index("ix_automation_rules_matter_id", "automation_rules", ["matter_id"])
    op.create_index("ix_automation_rules_trigger", "automation_rules", ["trigger_type", "status"])
    op.create_index("ix_automation_rules_matter", "automation_rules", ["matter_id"])

    op.create_table(
        "entity_relations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_type", sa.String(length=50), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("relation", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("href", sa.String(length=500), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("meta", _jsonb(), server_default="{}", nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["governance_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "matter_id",
            "case_id",
            "source_type",
            "source_id",
            "target_type",
            "target_id",
            "relation",
            name="uq_entity_relations_edge",
        ),
    )
    op.create_index("ix_entity_relations_matter_id", "entity_relations", ["matter_id"])
    op.create_index("ix_entity_relations_case_id", "entity_relations", ["case_id"])
    op.create_index("ix_entity_relations_target_type", "entity_relations", ["target_type"])
    op.create_index("ix_entity_relations_matter", "entity_relations", ["matter_id", "target_type"])
    op.create_index("ix_entity_relations_case", "entity_relations", ["case_id", "target_type"])
    op.create_index("ix_entity_relations_target", "entity_relations", ["target_type", "target_id"])

    op.create_table(
        "timeline_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_email", sa.String(length=255), nullable=True),
        sa.Column("payload", _jsonb(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["case_id"], ["governance_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_timeline_events_matter_id", "timeline_events", ["matter_id"])
    op.create_index("ix_timeline_events_case_id", "timeline_events", ["case_id"])
    op.create_index("ix_timeline_events_event_type", "timeline_events", ["event_type"])
    op.create_index(
        "ix_timeline_events_matter_created", "timeline_events", ["matter_id", "created_at"]
    )
    op.create_index("ix_timeline_events_case_created", "timeline_events", ["case_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_timeline_events_case_created", table_name="timeline_events")
    op.drop_index("ix_timeline_events_matter_created", table_name="timeline_events")
    op.drop_index("ix_timeline_events_event_type", table_name="timeline_events")
    op.drop_index("ix_timeline_events_case_id", table_name="timeline_events")
    op.drop_index("ix_timeline_events_matter_id", table_name="timeline_events")
    op.drop_table("timeline_events")

    op.drop_index("ix_automation_rules_matter", table_name="automation_rules")
    op.drop_index("ix_automation_rules_trigger", table_name="automation_rules")
    op.drop_index("ix_automation_rules_matter_id", table_name="automation_rules")
    op.drop_index("ix_automation_rules_status", table_name="automation_rules")
    op.drop_index("ix_automation_rules_trigger_type", table_name="automation_rules")
    op.drop_table("automation_rules")

    op.drop_index(
        "ix_governance_workflow_templates_type", table_name="governance_workflow_templates"
    )
    op.drop_index(
        "ix_governance_workflow_templates_is_active",
        table_name="governance_workflow_templates",
    )
    op.drop_index(
        "ix_governance_workflow_templates_template_type",
        table_name="governance_workflow_templates",
    )
    op.drop_table("governance_workflow_templates")

    op.drop_index("ix_matter_role_assignments_user", table_name="matter_role_assignments")
    op.drop_index("ix_matter_role_assignments_matter", table_name="matter_role_assignments")
    op.drop_index("ix_matter_role_assignments_is_active", table_name="matter_role_assignments")
    op.drop_index("ix_matter_role_assignments_user_id", table_name="matter_role_assignments")
    op.drop_index("ix_matter_role_assignments_parent_id", table_name="matter_role_assignments")
    op.drop_index("ix_matter_role_assignments_matter_id", table_name="matter_role_assignments")
    op.drop_table("matter_role_assignments")

    op.drop_index(
        "ix_planning_document_revisions_document", table_name="planning_document_revisions"
    )
    op.drop_index(
        "ix_planning_document_revisions_document_id", table_name="planning_document_revisions"
    )
    op.drop_table("planning_document_revisions")

    op.drop_index("ix_planning_documents_matter_status", table_name="planning_documents")
    op.drop_index("ix_planning_documents_is_active", table_name="planning_documents")
    op.drop_index("ix_planning_documents_case", table_name="planning_documents")
    op.drop_index("ix_planning_documents_matter_id", table_name="planning_documents")
    op.drop_index("ix_planning_documents_status", table_name="planning_documents")
    op.drop_index("ix_planning_documents_title", table_name="planning_documents")
    op.drop_table("planning_documents")

    op.drop_index("ix_decisions_source", table_name="decisions")
    op.drop_index("ix_decisions_owner_status", table_name="decisions")
    op.drop_index("ix_decisions_matter_status", table_name="decisions")
    op.drop_index("ix_decisions_owner_user_id", table_name="decisions")
    op.drop_index("ix_decisions_source_type", table_name="decisions")
    op.drop_index("ix_decisions_case_id", table_name="decisions")
    op.drop_index("ix_decisions_matter_id", table_name="decisions")
    op.drop_index("ix_decisions_status", table_name="decisions")
    op.drop_index("ix_decisions_title", table_name="decisions")
    op.drop_table("decisions")

    op.drop_index("ix_entity_relations_target", table_name="entity_relations")
    op.drop_index("ix_entity_relations_case", table_name="entity_relations")
    op.drop_index("ix_entity_relations_matter", table_name="entity_relations")
    op.drop_index("ix_entity_relations_target_type", table_name="entity_relations")
    op.drop_index("ix_entity_relations_case_id", table_name="entity_relations")
    op.drop_index("ix_entity_relations_matter_id", table_name="entity_relations")
    op.drop_table("entity_relations")

    op.drop_index("ix_governance_cases_owner_status", table_name="governance_cases")
    op.drop_index("ix_governance_cases_program_status", table_name="governance_cases")
    op.drop_index("ix_governance_cases_matter_status", table_name="governance_cases")
    op.drop_index("ix_governance_cases_is_active", table_name="governance_cases")
    op.drop_index("ix_governance_cases_status", table_name="governance_cases")
    op.drop_index("ix_governance_cases_owner_user_id", table_name="governance_cases")
    op.drop_index("ix_governance_cases_program_id", table_name="governance_cases")
    op.drop_index("ix_governance_cases_matter_id", table_name="governance_cases")
    op.drop_index("ix_governance_cases_title", table_name="governance_cases")
    op.drop_table("governance_cases")

    op.drop_index("ix_programs_status", table_name="programs")
    op.drop_index("ix_programs_is_active", table_name="programs")
    op.drop_index("ix_programs_matter_status", table_name="programs")
    op.drop_index("ix_programs_matter_id", table_name="programs")
    op.drop_table("programs")

    op.drop_index("ix_matters_visibility", table_name="matters")
    op.drop_index("ix_matters_priority", table_name="matters")
    op.drop_index("ix_matters_status", table_name="matters")
    op.drop_index("ix_matters_is_active", table_name="matters")
    op.drop_index("ix_matters_type_status", table_name="matters")
    op.drop_index("ix_matters_owner_status", table_name="matters")
    op.drop_index("ix_matters_org_status", table_name="matters")
    op.drop_index("ix_matters_title", table_name="matters")
    op.drop_table("matters")
