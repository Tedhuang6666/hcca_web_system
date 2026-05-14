"""add petition system

Revision ID: c8d9e0f1a2b3
Revises: b2c3d4e5f6a8
Create Date: 2026-05-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c8d9e0f1a2b3"
down_revision: str | Sequence[str] | None = "b2c3d4e5f6a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


petition_status = postgresql.ENUM(
    "submitted",
    "assigned",
    "in_progress",
    "needs_info",
    "transferred",
    "resolved",
    "closed",
    "rejected",
    name="petitionstatus",
    create_type=False,
)
petition_event_type = postgresql.ENUM(
    "created",
    "assigned",
    "status_changed",
    "transferred",
    "needs_info",
    "supplemented",
    "replied",
    "closed",
    "rejected",
    "note",
    "attachment_added",
    name="petitioneventtype",
    create_type=False,
)
petition_event_visibility = postgresql.ENUM(
    "public", "internal", name="petitioneventvisibility", create_type=False
)
petition_attachment_visibility = postgresql.ENUM(
    "public", "internal", name="petitionattachmentvisibility", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    petition_status.create(bind, checkfirst=True)
    petition_event_type.create(bind, checkfirst=True)
    petition_event_visibility.create(bind, checkfirst=True)
    petition_attachment_visibility.create(bind, checkfirst=True)

    op.create_table(
        "petition_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("responsible_org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["responsible_org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_petition_types_is_active"), "petition_types", ["is_active"])
    op.create_index(op.f("ix_petition_types_name"), "petition_types", ["name"], unique=True)
    op.create_index(
        op.f("ix_petition_types_responsible_org_id"),
        "petition_types",
        ["responsible_org_id"],
    )
    op.create_index(op.f("ix_petition_types_sort_order"), "petition_types", ["sort_order"])

    op.create_table(
        "petition_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_number", sa.String(length=7), nullable=False),
        sa.Column("verification_code_hash", sa.String(length=128), nullable=False),
        sa.Column("type_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", petition_status, nullable=False),
        sa.Column("is_named", sa.Boolean(), nullable=False),
        sa.Column("submitter_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("contact_name", sa.String(length=100), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("contact_phone", sa.String(length=30), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("public_reply", sa.Text(), nullable=True),
        sa.Column("latest_internal_note", sa.Text(), nullable=True),
        sa.Column("supplement_request", sa.Text(), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("current_org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assigned_to_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["assigned_to_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["current_org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["submitter_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["type_id"], ["petition_types.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_petition_cases_case_number"),
        "petition_cases",
        ["case_number"],
        unique=True,
    )
    for col in ("assigned_to_id", "current_org_id", "is_named", "status", "submitter_id", "title", "type_id"):
        op.create_index(op.f(f"ix_petition_cases_{col}"), "petition_cases", [col])

    op.create_table(
        "petition_case_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", petition_event_type, nullable=False),
        sa.Column("visibility", petition_event_visibility, nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("from_org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("to_org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("from_status", sa.String(length=30), nullable=True),
        sa.Column("to_status", sa.String(length=30), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["case_id"], ["petition_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["from_org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["to_org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ("actor_id", "case_id", "event_type", "visibility"):
        op.create_index(op.f(f"ix_petition_case_events_{col}"), "petition_case_events", [col])

    op.create_table(
        "petition_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("visibility", petition_attachment_visibility, nullable=False),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["case_id"], ["petition_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_petition_attachments_case_id"), "petition_attachments", ["case_id"])
    op.create_index(
        op.f("ix_petition_attachments_visibility"), "petition_attachments", ["visibility"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_petition_attachments_visibility"), table_name="petition_attachments")
    op.drop_index(op.f("ix_petition_attachments_case_id"), table_name="petition_attachments")
    op.drop_table("petition_attachments")
    for col in ("actor_id", "case_id", "event_type", "visibility"):
        op.drop_index(op.f(f"ix_petition_case_events_{col}"), table_name="petition_case_events")
    op.drop_table("petition_case_events")
    for col in ("assigned_to_id", "case_number", "current_org_id", "is_named", "status", "submitter_id", "title", "type_id"):
        op.drop_index(op.f(f"ix_petition_cases_{col}"), table_name="petition_cases")
    op.drop_table("petition_cases")
    op.drop_index(op.f("ix_petition_types_sort_order"), table_name="petition_types")
    op.drop_index(op.f("ix_petition_types_responsible_org_id"), table_name="petition_types")
    op.drop_index(op.f("ix_petition_types_name"), table_name="petition_types")
    op.drop_index(op.f("ix_petition_types_is_active"), table_name="petition_types")
    op.drop_table("petition_types")

    bind = op.get_bind()
    petition_attachment_visibility.drop(bind, checkfirst=True)
    petition_event_visibility.drop(bind, checkfirst=True)
    petition_event_type.drop(bind, checkfirst=True)
    petition_status.drop(bind, checkfirst=True)
