"""新增陳情密件原因"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260925100000"
down_revision: str | Sequence[str] | None = "20260924100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("petition_cases", sa.Column("confidential_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("petition_cases", "confidential_reason")
