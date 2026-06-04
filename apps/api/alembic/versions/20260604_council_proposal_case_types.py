"""council proposal case types + regulation link

Revision ID: 20260604councilcases
Revises: 20260604emailretry
Create Date: 2026-06-04 00:00:00.000000

將議會提案擴充為六大案件類型：新增 case_type 與 regulation_id 欄位，並將
kind（法規案子類型）改為可空（非法規案不帶子類型）。既有資料皆為法規案，
case_type server_default='regulation' 對既有列安全。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260604councilcases"
down_revision = "20260604emailretry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "council_proposals",
        sa.Column(
            "case_type",
            sa.String(length=20),
            server_default="regulation",
            nullable=False,
        ),
    )
    op.add_column(
        "council_proposals",
        sa.Column("regulation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_council_proposals_regulation_id",
        "council_proposals",
        "regulations",
        ["regulation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_council_proposals_case_type", "council_proposals", ["case_type"])
    op.create_index(
        "ix_council_proposals_regulation_id", "council_proposals", ["regulation_id"]
    )
    # kind 改為可空：非法規案不帶法規子類型。
    op.alter_column(
        "council_proposals",
        "kind",
        existing_type=sa.String(length=20),
        nullable=True,
    )


def downgrade() -> None:
    # 回填 kind 預設值以滿足 NOT NULL 還原（既有非法規案理論上不存在於降級情境）。
    op.execute("UPDATE council_proposals SET kind = 'enact' WHERE kind IS NULL")
    op.alter_column(
        "council_proposals",
        "kind",
        existing_type=sa.String(length=20),
        nullable=False,
    )
    op.drop_index("ix_council_proposals_regulation_id", table_name="council_proposals")
    op.drop_index("ix_council_proposals_case_type", table_name="council_proposals")
    op.drop_constraint(
        "fk_council_proposals_regulation_id", "council_proposals", type_="foreignkey"
    )
    op.drop_column("council_proposals", "regulation_id")
    op.drop_column("council_proposals", "case_type")
