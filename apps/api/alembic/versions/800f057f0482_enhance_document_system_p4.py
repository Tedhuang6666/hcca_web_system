"""enhance_document_system_p4

Revision ID: 800f057f0482
Revises: d05c8d53bf3a
Create Date: 2026-04-10 01:50:32.619573

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '800f057f0482'
down_revision: Union[str, Sequence[str], None] = 'd05c8d53bf3a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. 建立 Sequence
    op.execute("CREATE SEQUENCE IF NOT EXISTS document_serial_seq START 1")
    op.execute("CREATE SEQUENCE IF NOT EXISTS order_serial_seq START 1")

    # 2. 手動建立 Enum 型別 (加上判斷避免重複)
    # 使用 op.execute 配合 PostgreSQL 的 DO 區塊是最強制的做法
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recipienttype') THEN
                CREATE TYPE recipienttype AS ENUM ('MAIN', 'PRIMARY', 'COPY');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'documenturgency') THEN
                CREATE TYPE documenturgency AS ENUM ('EXPRESS', 'PRIORITY', 'NORMAL');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'documentclassification') THEN
                CREATE TYPE documentclassification AS ENUM ('NORMAL', 'CONFIDENTIAL', 'SECRET');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'documentcategory') THEN
                CREATE TYPE documentcategory AS ENUM ('DECREE', 'LETTER', 'ANNOUNCEMENT', 'REPORT', 'OTHER');
            END IF;
        END $$;
    """)

    # 3. 建立表格
    op.create_table('document_recipients',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('document_id', sa.UUID(), nullable=False),
        # 重要：create_type=False 告訴 Alembic 不要嘗試建立型別，因為我們上面建過了
        sa.Column('recipient_type', postgresql.ENUM('MAIN', 'PRIMARY', 'COPY', name='recipienttype', create_type=False), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('email', sa.String(length=200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_document_recipients_document_id'), 'document_recipients', ['document_id'], unique=False)

    # 4. 修改現有表格
    op.add_column('document_approvals', sa.Column('delegate_id', sa.UUID(), nullable=True))
    op.add_column('document_approvals', sa.Column('is_acting', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.create_index(op.f('ix_document_approvals_delegate_id'), 'document_approvals', ['delegate_id'], unique=False)
    op.create_foreign_key(None, 'document_approvals', 'users', ['delegate_id'], ['id'], ondelete='SET NULL')

    # 5. 在 documents 增加 Enum 欄位
    op.add_column('documents', sa.Column('urgency', postgresql.ENUM('EXPRESS', 'PRIORITY', 'NORMAL', name='documenturgency', create_type=False), nullable=False))
    op.add_column('documents', sa.Column('classification', postgresql.ENUM('NORMAL', 'CONFIDENTIAL', 'SECRET', name='documentclassification', create_type=False), nullable=False))
    op.add_column('documents', sa.Column('category', postgresql.ENUM('DECREE', 'LETTER', 'ANNOUNCEMENT', 'REPORT', 'OTHER', name='documentcategory', create_type=False), nullable=False))
    
    op.add_column('documents', sa.Column('subject', sa.String(length=500), nullable=True))
    op.add_column('documents', sa.Column('doc_description', sa.Text(), nullable=True))
    op.add_column('documents', sa.Column('action_required', sa.Text(), nullable=True))
    op.add_column('documents', sa.Column('issuer_org_name', sa.String(length=200), nullable=True))
    op.add_column('documents', sa.Column('handler_name', sa.String(length=50), nullable=True))
    op.add_column('documents', sa.Column('handler_unit', sa.String(length=100), nullable=True))
    op.add_column('documents', sa.Column('handler_phone', sa.String(length=30), nullable=True))
    op.add_column('documents', sa.Column('handler_email', sa.String(length=200), nullable=True))
    op.add_column('documents', sa.Column('issued_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('documents', sa.Column('due_date', sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f('ix_documents_category'), 'documents', ['category'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_documents_category'), table_name='documents')
    
    columns_to_drop = [
        'due_date', 'issued_at', 'handler_email', 'handler_phone', 
        'handler_unit', 'handler_name', 'issuer_org_name', 
        'action_required', 'doc_description', 'subject', 
        'category', 'classification', 'urgency'
    ]
    for col in columns_to_drop:
        op.drop_column('documents', col)

    op.drop_constraint(None, 'document_approvals', type_='foreignkey')
    op.drop_index(op.f('ix_document_approvals_delegate_id'), table_name='document_approvals')
    op.drop_column('document_approvals', 'is_acting')
    op.drop_column('document_approvals', 'delegate_id')
    op.drop_index(op.f('ix_document_recipients_document_id'), table_name='document_recipients')
    op.drop_table('document_recipients')

    # 移除 Enum 型別
    op.execute("DROP TYPE IF EXISTS recipienttype")
    op.execute("DROP TYPE IF EXISTS documenturgency")
    op.execute("DROP TYPE IF EXISTS documentclassification")
    op.execute("DROP TYPE IF EXISTS documentcategory")
    
    # 移除 Sequence
    op.execute("DROP SEQUENCE IF EXISTS document_serial_seq")
    op.execute("DROP SEQUENCE IF EXISTS order_serial_seq")