"""add meeting notice email message id

Revision ID: 20260704120000
Revises: 5865fc9c5f7e
Create Date: 2026-07-04 12:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260704120000"
down_revision: str | Sequence[str] | None = "5865fc9c5f7e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "meetings",
        sa.Column(
            "notice_email_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("email_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_meetings_notice_email_message_id",
        "meetings",
        ["notice_email_message_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_meetings_notice_email_message_id", table_name="meetings")
    op.drop_column("meetings", "notice_email_message_id")
