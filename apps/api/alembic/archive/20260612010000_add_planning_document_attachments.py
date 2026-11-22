"""新增企劃書共用附件與版本引用。

Revision ID: 20260612010000
Revises: 20260608010000
Create Date: 2026-06-12 01:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260612010000"
down_revision: str | None = "20260608010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "planning_document_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["document_id"], ["planning_documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_planning_document_attachments_document_id"),
        "planning_document_attachments",
        ["document_id"],
        unique=False,
    )
    op.create_table(
        "planning_document_revision_attachments",
        sa.Column("revision_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attachment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["attachment_id"],
            ["planning_document_attachments.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["revision_id"],
            ["planning_document_revisions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("revision_id", "attachment_id"),
    )
    op.create_index(
        "ix_planning_revision_attachments_revision",
        "planning_document_revision_attachments",
        ["revision_id", "sort_order"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_planning_revision_attachments_revision",
        table_name="planning_document_revision_attachments",
    )
    op.drop_table("planning_document_revision_attachments")
    op.drop_index(
        op.f("ix_planning_document_attachments_document_id"),
        table_name="planning_document_attachments",
    )
    op.drop_table("planning_document_attachments")
