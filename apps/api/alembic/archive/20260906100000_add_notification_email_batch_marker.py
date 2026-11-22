"""add notification email batch marker"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260906100000"
down_revision: str | Sequence[str] | None = "20260905120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("email_queued_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_notifications_email_batch",
        "notifications",
        ["user_id", "type", "email_queued_at", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_email_batch", table_name="notifications")
    op.drop_column("notifications", "email_queued_at")
