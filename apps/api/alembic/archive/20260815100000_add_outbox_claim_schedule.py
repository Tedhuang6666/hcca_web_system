"""為 Outbox 增加排程、租約 claim 與重試索引。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260815100000"
down_revision: str | Sequence[str] | None = "20260814170000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "outbox_events",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "outbox_events",
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "outbox_events",
        sa.Column("locked_by", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_outbox_events_next_attempt_at",
        "outbox_events",
        ["next_attempt_at"],
    )
    op.create_index(
        "ix_outbox_events_locked_until",
        "outbox_events",
        ["locked_until"],
    )
    op.create_index(
        "ix_outbox_pending_schedule",
        "outbox_events",
        ["status", "next_attempt_at", "locked_until", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_outbox_pending_schedule", table_name="outbox_events")
    op.drop_index("ix_outbox_events_locked_until", table_name="outbox_events")
    op.drop_index("ix_outbox_events_next_attempt_at", table_name="outbox_events")
    op.drop_column("outbox_events", "locked_by")
    op.drop_column("outbox_events", "locked_until")
    op.drop_column("outbox_events", "next_attempt_at")
