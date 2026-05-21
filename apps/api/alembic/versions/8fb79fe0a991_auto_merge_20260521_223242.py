"""auto_merge_20260521_223242

Revision ID: 8fb79fe0a991
Revises: 20260521_meeting_v2, 20260523100000
Create Date: 2026-05-21 22:32:42.948208

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8fb79fe0a991'
down_revision: Union[str, Sequence[str], None] = ('20260521_meeting_v2', '20260523100000')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
