"""add_regulation_document_crossref

Revision ID: a7b8c9d0e1f2
Revises: 42c37ca7119c
Create Date: 2026-05-01 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: str | Sequence[str] | None = '42c37ca7119c'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # regulations.published_document_id → documents.id（法規公布令連結）
    op.add_column('regulations',
        sa.Column('published_document_id', sa.UUID(), nullable=True)
    )
    op.create_index(
        'ix_regulations_published_document_id',
        'regulations', ['published_document_id'], unique=False
    )
    op.create_foreign_key(
        'fk_regulations_published_document_id',
        'regulations', 'documents',
        ['published_document_id'], ['id'],
        ondelete='SET NULL',
    )

    # documents.regulation_id → regulations.id（令類公文所公布的法規）
    op.add_column('documents',
        sa.Column('regulation_id', sa.UUID(), nullable=True)
    )
    op.create_index(
        'ix_documents_regulation_id',
        'documents', ['regulation_id'], unique=False
    )
    op.create_foreign_key(
        'fk_documents_regulation_id',
        'documents', 'regulations',
        ['regulation_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_documents_regulation_id', 'documents', type_='foreignkey')
    op.drop_index('ix_documents_regulation_id', table_name='documents')
    op.drop_column('documents', 'regulation_id')

    op.drop_constraint('fk_regulations_published_document_id', 'regulations', type_='foreignkey')
    op.drop_index('ix_regulations_published_document_id', table_name='regulations')
    op.drop_column('regulations', 'published_document_id')
