"""meeting simple deliberation mode

Revision ID: 20260604simplemode
Revises: 20260604seating
Create Date: 2026-06-04 21:00:00.000000

議事系統新增「簡易評議模式」：
- meetings.mode（simple/full）。既有會議回填 full 以維持完整議會行為；新建預設 simple。
- meeting_votes 擴充 record_method / options / manual_tally / result_label，
  支援無異議通過、主席口頭計票、自訂選項。
- meeting_ballots.option_key 供自訂選項逐人票。
- 新表 meeting_agenda_recusals：逐案委員迴避。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260604simplemode"
down_revision: Union[str, Sequence[str], None] = "20260604seating"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── meetings.mode ─────────────────────────────────────────────────────────
    # 先以 server_default='full' 加欄，讓既有會議回填為完整議事，
    # 再把預設改為 'simple'，使未來新建會議預設走簡易評議。
    op.add_column(
        "meetings",
        sa.Column(
            "mode", sa.String(length=10), nullable=False, server_default="full"
        ),
    )
    op.alter_column("meetings", "mode", server_default="simple")

    # ── meeting_votes 擴充 ────────────────────────────────────────────────────
    op.add_column(
        "meeting_votes",
        sa.Column(
            "record_method",
            sa.String(length=20),
            nullable=False,
            server_default="ballots",
        ),
    )
    op.add_column(
        "meeting_votes",
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "meeting_votes",
        sa.Column("manual_tally", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "meeting_votes",
        sa.Column("result_label", sa.String(length=200), nullable=True),
    )

    # ── meeting_ballots.option_key ────────────────────────────────────────────
    op.add_column(
        "meeting_ballots",
        sa.Column("option_key", sa.String(length=50), nullable=True),
    )

    # ── meeting_agenda_recusals（逐案迴避）────────────────────────────────────
    op.create_table(
        "meeting_agenda_recusals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agenda_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["agenda_item_id"], ["meeting_agenda_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agenda_item_id", "user_id", name="uq_meeting_agenda_recusal"),
    )
    op.create_index(
        "ix_meeting_agenda_recusals_agenda_item_id",
        "meeting_agenda_recusals",
        ["agenda_item_id"],
    )
    op.create_index(
        "ix_meeting_agenda_recusals_user_id",
        "meeting_agenda_recusals",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_meeting_agenda_recusals_user_id", table_name="meeting_agenda_recusals")
    op.drop_index(
        "ix_meeting_agenda_recusals_agenda_item_id", table_name="meeting_agenda_recusals"
    )
    op.drop_table("meeting_agenda_recusals")
    op.drop_column("meeting_ballots", "option_key")
    op.drop_column("meeting_votes", "result_label")
    op.drop_column("meeting_votes", "manual_tally")
    op.drop_column("meeting_votes", "options")
    op.drop_column("meeting_votes", "record_method")
    op.drop_column("meetings", "mode")
