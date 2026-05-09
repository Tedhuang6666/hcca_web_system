"""add other to regulationcategory enum and meeting_notice to documentcategory

Revision ID: f1a2b3c4d5e6
Revises: a7b8c9d0e1f2
Create Date: 2026-05-01 12:00:00.000000

"""
from alembic import op

revision = 'f1a2b3c4d5e6'
down_revision = 'a7b8c9d0e1f2'

def upgrade() -> None:
    # 新增 'other' 到 regulationcategory（原始 enum 有 OTHER 但大寫，正規化後遺失）
    op.execute("ALTER TYPE regulationcategory ADD VALUE IF NOT EXISTS 'other'")
    # 新增 meeting_notice 到 documentcategory（如果尚未存在）
    op.execute("ALTER TYPE documentcategory ADD VALUE IF NOT EXISTS 'meeting_notice'")

def downgrade() -> None:
    # PostgreSQL 不支援移除 enum 值
    pass
