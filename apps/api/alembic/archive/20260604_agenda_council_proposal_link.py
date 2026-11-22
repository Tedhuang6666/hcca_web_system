"""link council proposals onto meeting agenda items

Revision ID: 20260604agendaproposal
Revises: 20260604councilcases
Create Date: 2026-06-04 00:00:00.000000

讓常務委員會 / 大會議程可直接帶入議會提案：meeting_agenda_items 新增
council_proposal_id（FK → council_proposals，ON DELETE SET NULL），並擴充
item_type 允許值 'council_proposal'（String 欄位，無需改 DB enum）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260604agendaproposal"
down_revision = "20260604councilcases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meeting_agenda_items",
        sa.Column("council_proposal_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_meeting_agenda_items_council_proposal_id",
        "meeting_agenda_items",
        "council_proposals",
        ["council_proposal_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_meeting_agenda_items_council_proposal_id",
        "meeting_agenda_items",
        ["council_proposal_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_meeting_agenda_items_council_proposal_id", table_name="meeting_agenda_items"
    )
    op.drop_constraint(
        "fk_meeting_agenda_items_council_proposal_id",
        "meeting_agenda_items",
        type_="foreignkey",
    )
    op.drop_column("meeting_agenda_items", "council_proposal_id")
