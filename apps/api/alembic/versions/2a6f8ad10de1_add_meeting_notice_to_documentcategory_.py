"""add_meeting_notice_to_documentcategory_enum

Revision ID: 2a6f8ad10de1
Revises: 3ef7eca13d46
Create Date: 2026-04-25 12:18:26.674722

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2a6f8ad10de1'
down_revision: Union[str, Sequence[str], None] = '3ef7eca13d46'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE documentcategory ADD VALUE IF NOT EXISTS 'meeting_notice'")


def downgrade() -> None:
    """Downgrade schema."""
    # PostgreSQL 不支援直接移除 enum 值，downgrade 為 no-op
    pass
