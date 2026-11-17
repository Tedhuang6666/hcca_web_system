"""track first official document email delivery"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260906110000"
down_revision: str | Sequence[str] | None = "20260906100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("recipient_email_sent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("documents", "recipient_email_sent_at")
