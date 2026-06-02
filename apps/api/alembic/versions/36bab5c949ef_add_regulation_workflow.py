"""add_regulation_workflow

Revision ID: 36bab5c949ef
Revises: a64cf15a8918
Create Date: 2026-04-24 16:06:23.167467

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '36bab5c949ef'
down_revision: str | Sequence[str] | None = 'a64cf15a8918'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


WORKFLOW_STATUS_ENUM = sa.Enum(
    'draft', 'under_review', 'scheduled', 'council_approved', 'published', 'rejected', 'archived',
    name='regulationworkflowstatus',
)


def upgrade() -> None:
    WORKFLOW_STATUS_ENUM.create(op.get_bind(), checkfirst=True)
    op.create_table('regulation_workflow_logs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('regulation_id', sa.UUID(), nullable=False),
    sa.Column('from_status', sa.String(length=50), nullable=False),
    sa.Column('to_status', sa.String(length=50), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['regulation_id'], ['regulations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_regulation_workflow_logs_regulation_id'), 'regulation_workflow_logs', ['regulation_id'], unique=False)
    op.add_column('regulations', sa.Column(
        'workflow_status', WORKFLOW_STATUS_ENUM,
        server_default='draft', nullable=False,
    ))
    op.add_column('regulations', sa.Column('workflow_note', sa.Text(), nullable=True))
    # backfill: published → 'published', archived → 'archived'
    op.execute("UPDATE regulations SET workflow_status = 'published' WHERE published_at IS NOT NULL AND is_active = TRUE")
    op.execute("UPDATE regulations SET workflow_status = 'archived' WHERE is_active = FALSE")


def downgrade() -> None:
    op.drop_column('regulations', 'workflow_note')
    op.drop_column('regulations', 'workflow_status')
    op.drop_index(op.f('ix_regulation_workflow_logs_regulation_id'), table_name='regulation_workflow_logs')
    op.drop_table('regulation_workflow_logs')
    WORKFLOW_STATUS_ENUM.drop(op.get_bind(), checkfirst=True)
