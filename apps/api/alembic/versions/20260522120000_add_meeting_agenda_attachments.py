"""add meeting agenda attachments

Revision ID: 20260522120000
Revises: 20260522110000
Create Date: 2026-05-22 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260522120000"
down_revision: str | Sequence[str] | None = "20260522110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "meeting_agenda_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agenda_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("storage_key", sa.String(length=500), nullable=True),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column("link_url", sa.String(length=2048), nullable=True),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(
            ["agenda_item_id"], ["meeting_agenda_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_meeting_agenda_attachments_agenda_item_id",
        "meeting_agenda_attachments",
        ["agenda_item_id"],
    )
    op.create_index(
        "ix_meeting_agenda_attachments_item_created",
        "meeting_agenda_attachments",
        ["agenda_item_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_meeting_agenda_attachments_item_created",
        table_name="meeting_agenda_attachments",
    )
    op.drop_index(
        "ix_meeting_agenda_attachments_agenda_item_id",
        table_name="meeting_agenda_attachments",
    )
    op.drop_table("meeting_agenda_attachments")
