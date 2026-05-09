"""add_org_prefix_drop_issuer_org_name

Revision ID: ab702da0cae9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-23 21:29:34.666621

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ab702da0cae9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 新增 orgs.prefix 欄位（字號前綴，如「嶺代」）
    op.add_column('orgs', sa.Column('prefix', sa.String(length=20), nullable=True))
    # 移除 documents.issuer_org_name 欄位（改由 org 關聯取得）
    op.drop_column('documents', 'issuer_org_name')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('documents', sa.Column('issuer_org_name', sa.VARCHAR(length=200), autoincrement=False, nullable=True))
    op.drop_column('orgs', 'prefix')
