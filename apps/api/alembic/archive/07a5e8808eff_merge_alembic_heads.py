"""merge alembic heads

Revision ID: 07a5e8808eff
Revises: 20260602093000, f2a4c6d8e901
Create Date: 2026-06-03 02:01:21.941442

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '07a5e8808eff'
down_revision: Union[str, Sequence[str], None] = ('20260602093000', 'f2a4c6d8e901')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
