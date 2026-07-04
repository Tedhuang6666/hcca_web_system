"""merge_heads_for_shop_close

Revision ID: 5694b02b3aeb
Revises: 20260701090000, 20260705000000
Create Date: 2026-07-04 15:48:33.391838

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5694b02b3aeb'
down_revision: Union[str, Sequence[str], None] = ('20260701090000', '20260705000000')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
