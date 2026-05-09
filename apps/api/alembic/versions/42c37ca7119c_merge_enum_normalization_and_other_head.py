"""merge enum normalization and other head

Revision ID: 42c37ca7119c
Revises: e5f6a7b8c9d0, b2c3d4e5f6a7
Create Date: 2026-04-26 00:03:07.712002

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '42c37ca7119c'
down_revision: Union[str, Sequence[str], None] = ('e5f6a7b8c9d0', 'b2c3d4e5f6a7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
