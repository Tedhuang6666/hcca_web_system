"""add email outbox retry bookkeeping (attempt_count, next_retry_at)

Revision ID: 20260604emailretry
Revises: 20260603counciljudicial
Create Date: 2026-06-04 00:00:00.000000

新增 email_messages 與 email_campaign_recipients 的重試簿記欄位，支援
RETRYING / DEAD 狀態與退避重試（status 為既有的 String 欄位，新增的兩個
enum 值不需 DB 變更）。欄位皆 NOT NULL server_default 0 / NULL，對既有資料安全。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260604emailretry"
down_revision = "20260603counciljudicial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("email_messages", "email_campaign_recipients"):
        op.add_column(
            table,
            sa.Column(
                "attempt_count",
                sa.Integer(),
                server_default="0",
                nullable=False,
            ),
        )
        op.add_column(
            table,
            sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    for table in ("email_messages", "email_campaign_recipients"):
        op.drop_column(table, "next_retry_at")
        op.drop_column(table, "attempt_count")
