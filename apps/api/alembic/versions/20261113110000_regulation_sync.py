"""法規 Drive 同步來源與排程。

Revision ID: 20261113110000
Revises: 20261113100000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261113110000"
down_revision = "20261113100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "regulation_sync_sources",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "org_id",
            sa.UUID(),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "created_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("folder_id", sa.String(200), nullable=False),
        sa.Column("frequency", sa.String(10), nullable=False),
        sa.Column("next_sync_at", sa.DateTime(timezone=True)),
        sa.Column("requested_at", sa.DateTime(timezone=True)),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("last_report", postgresql.JSONB(), nullable=False),
        sa.Column("manifest", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("regulation_sync_sources")
