"""add document approval delegations

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2026-05-06 16:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a8"
down_revision = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    delegate_source = sa.Enum("manual", "assignment", name="delegatesource")
    delegate_source.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "document_approvals",
        sa.Column("delegate_source", delegate_source, nullable=True),
    )

    op.create_table(
        "document_approval_delegations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("principal_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("delegate_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["delegate_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["principal_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_document_approval_delegations_org_id"), "document_approval_delegations", ["org_id"], unique=False)
    op.create_index(op.f("ix_document_approval_delegations_principal_user_id"), "document_approval_delegations", ["principal_user_id"], unique=False)
    op.create_index(op.f("ix_document_approval_delegations_delegate_user_id"), "document_approval_delegations", ["delegate_user_id"], unique=False)
    op.create_index(op.f("ix_document_approval_delegations_start_at"), "document_approval_delegations", ["start_at"], unique=False)
    op.create_index(op.f("ix_document_approval_delegations_end_at"), "document_approval_delegations", ["end_at"], unique=False)
    op.create_index(op.f("ix_document_approval_delegations_is_active"), "document_approval_delegations", ["is_active"], unique=False)
    op.create_index(op.f("ix_document_approval_delegations_created_by"), "document_approval_delegations", ["created_by"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_document_approval_delegations_created_by"), table_name="document_approval_delegations")
    op.drop_index(op.f("ix_document_approval_delegations_is_active"), table_name="document_approval_delegations")
    op.drop_index(op.f("ix_document_approval_delegations_end_at"), table_name="document_approval_delegations")
    op.drop_index(op.f("ix_document_approval_delegations_start_at"), table_name="document_approval_delegations")
    op.drop_index(op.f("ix_document_approval_delegations_delegate_user_id"), table_name="document_approval_delegations")
    op.drop_index(op.f("ix_document_approval_delegations_principal_user_id"), table_name="document_approval_delegations")
    op.drop_index(op.f("ix_document_approval_delegations_org_id"), table_name="document_approval_delegations")
    op.drop_table("document_approval_delegations")
    op.drop_column("document_approvals", "delegate_source")
    sa.Enum(name="delegatesource").drop(op.get_bind(), checkfirst=True)
