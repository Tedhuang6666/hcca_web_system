"""add_link_url_to_document_attachment

Revision ID: b2c3d4e5f6a7
Revises: 2a6f8ad10de1
Create Date: 2026-04-25 14:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'b2c3d4e5f6a7'
down_revision: str | None = '2a6f8ad10de1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('document_attachments',
        sa.Column('link_url', sa.String(2048), nullable=True))
    op.alter_column('document_attachments', 'storage_key', existing_type=sa.String(500), nullable=True)
    op.alter_column('document_attachments', 'content_type', existing_type=sa.String(100), nullable=True)
    op.alter_column('document_attachments', 'file_size', existing_type=sa.BigInteger(), nullable=True)


def downgrade() -> None:
    op.drop_column('document_attachments', 'link_url')
    op.alter_column('document_attachments', 'file_size', existing_type=sa.BigInteger(), nullable=False)
    op.alter_column('document_attachments', 'content_type', existing_type=sa.String(100), nullable=False)
    op.alter_column('document_attachments', 'storage_key', existing_type=sa.String(500), nullable=False)
