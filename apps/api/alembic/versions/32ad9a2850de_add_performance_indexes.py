"""add_performance_indexes

Revision ID: 32ad9a2850de
Revises: 20260514111243
Create Date: 2026-05-14 12:05:59.609136

Performance optimization: Add indexes on frequently filtered/sorted columns.
Target columns identified from query patterns in list/filter endpoints.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '32ad9a2850de'
down_revision: Union[str, Sequence[str], None] = '20260514111243'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add performance indexes on frequently queried columns."""
    # Documents: status + org filtering, creation date sorting
    op.create_index(
        'ix_documents_org_status',
        'documents',
        ['org_id', 'status'],
        if_not_exists=True,
    )
    op.create_index(
        'ix_documents_created_at_desc',
        'documents',
        ['created_at'],
        if_not_exists=True,
    )

    # Document Approvals: status filtering in workflow queries
    op.create_index(
        'ix_document_approvals_status',
        'document_approvals',
        ['status'],
        if_not_exists=True,
    )

    # Regulations: active state + workflow status filtering
    op.create_index(
        'ix_regulations_is_active_workflow',
        'regulations',
        ['is_active', 'workflow_status'],
        if_not_exists=True,
    )

    # User Positions: user permission lookups + tenure date range
    op.create_index(
        'ix_user_positions_user_end_date',
        'user_positions',
        ['user_id', 'end_date'],
        if_not_exists=True,
    )

    # Organizations: hierarchy traversal + active state
    op.create_index(
        'ix_orgs_parent_active',
        'orgs',
        ['parent_id', 'is_active'],
        if_not_exists=True,
    )


def downgrade() -> None:
    """Remove performance indexes."""
    op.drop_index('ix_documents_org_status', table_name='documents', if_exists=True)
    op.drop_index('ix_documents_created_at_desc', table_name='documents', if_exists=True)
    op.drop_index('ix_document_approvals_status', table_name='document_approvals', if_exists=True)
    op.drop_index('ix_regulations_is_active_workflow', table_name='regulations', if_exists=True)
    op.drop_index('ix_user_positions_user_end_date', table_name='user_positions', if_exists=True)
    op.drop_index('ix_orgs_parent_active', table_name='orgs', if_exists=True)
