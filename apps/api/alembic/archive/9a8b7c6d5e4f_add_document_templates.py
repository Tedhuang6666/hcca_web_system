"""add document templates

Revision ID: 9a8b7c6d5e4f
Revises: fbc1a34fda7d
Create Date: 2026-05-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "9a8b7c6d5e4f"
down_revision: str | Sequence[str] | None = "fbc1a34fda7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

document_urgency = postgresql.ENUM(
    "express", "priority", "normal", name="documenturgency", create_type=False
)
document_classification = postgresql.ENUM(
    "normal", "confidential", "secret", name="documentclassification", create_type=False
)
declassification_condition = postgresql.ENUM(
    "none", "auto_at_date", "manual_approval", name="declassificationcondition", create_type=False
)
document_category = postgresql.ENUM(
    "decree",
    "letter",
    "announcement",
    "report",
    "meeting_notice",
    "other",
    name="documentcategory",
    create_type=False,
)
document_visibility = postgresql.ENUM(
    "subject_only",
    "org_only",
    "public",
    "publicly_open",
    name="documentvisibility",
    create_type=False,
)


def _enum(pg_enum: postgresql.ENUM, length: int = 32) -> sa.types.TypeEngine:
    return sa.String(length).with_variant(pg_enum, "postgresql")


def upgrade() -> None:
    op.create_table(
        "document_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("issuer_full_name", sa.String(length=200), nullable=True),
        sa.Column("urgency", _enum(document_urgency), nullable=False),
        sa.Column("classification", _enum(document_classification), nullable=False),
        sa.Column("declassification_condition", _enum(declassification_condition), nullable=False),
        sa.Column("category", _enum(document_category), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("doc_description", sa.Text(), nullable=True),
        sa.Column("action_required", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("meeting_purpose", sa.String(length=500), nullable=True),
        sa.Column("meeting_location", sa.String(length=200), nullable=True),
        sa.Column("meeting_chairperson", sa.String(length=100), nullable=True),
        sa.Column("handler_unit", sa.String(length=100), nullable=True),
        sa.Column("file_number", sa.String(length=100), nullable=True),
        sa.Column("retention_period", sa.String(length=100), nullable=True),
        sa.Column("visibility_level", _enum(document_visibility), nullable=False),
        sa.Column(
            "recipients",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "name", "version", name="uq_document_template_version"),
    )
    op.create_index("ix_document_templates_category", "document_templates", ["category"])
    op.create_index("ix_document_templates_created_by", "document_templates", ["created_by"])
    op.create_index("ix_document_templates_is_active", "document_templates", ["is_active"])
    op.create_index("ix_document_templates_org_active", "document_templates", ["org_id", "is_active"])
    op.create_index("ix_document_templates_org_id", "document_templates", ["org_id"])


def downgrade() -> None:
    op.drop_index("ix_document_templates_org_id", table_name="document_templates")
    op.drop_index("ix_document_templates_org_active", table_name="document_templates")
    op.drop_index("ix_document_templates_is_active", table_name="document_templates")
    op.drop_index("ix_document_templates_created_by", table_name="document_templates")
    op.drop_index("ix_document_templates_category", table_name="document_templates")
    op.drop_table("document_templates")
